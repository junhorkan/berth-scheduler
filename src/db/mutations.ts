/**
 * Every write the app performs.
 *
 * The database's exclusion constraint is the real guarantee — these functions check
 * first only so the UI can explain the problem before the user commits. If the two
 * ever disagree, the constraint wins and the insert throws, which is the correct
 * failure: a refused booking, never a silent double-booking.
 */
import type postgres from 'postgres';
import { db } from './client';
import { findConflicts, isValidRange } from '../domain/conflicts';
import { checkFit, type FitResult } from '../domain/fit';
import { canonicalVesselName } from '../domain/normalize';
import type { Booking, BookingKind } from '../domain/types';

/**
 * A connection or a transaction. The helpers below run inside either, and are cast to
 * the connection type internally because the two are called identically but do not
 * share a declared call signature.
 */
type Queryable = ReturnType<typeof db> | postgres.TransactionSql;

/**
 * The columns each table is snapshotted and restored through, written out rather than
 * `select *` for the same reason resetToImported does: `bookings.during` is GENERATED
 * and Postgres refuses to have one written to.
 */
const BOOKING_COLS =
  'id, berth_id, vessel_id, kind, status, label, start_date, end_date, exclusive, '
  + 'notes, source, import_year, import_sheet, import_row, import_col, created_at, cancelled_at';
const VESSEL_COLS =
  'id, canonical_name, normalized_name, length_ft, loa_ft, length_source, operator, '
  + 'notes, created_at';
const REVIEW_COLS =
  'id, type, booking_id, vessel_id, berth_id, raw_text, detail, import_year, '
  + 'import_sheet, import_row, import_col, resolved_at, created_at';

export type CheckResult = {
  bookable: boolean;
  /** Hard stop: overlapping bookings on this berth. */
  conflicts: { id: string; label: string; startDate: string; endDate: string }[];
  /** Advisory only. Never blocks. */
  fit: FitResult | null;
  /** Why Save is disabled, or null when it is not. */
  blockedBecause: string | null;
};

/** Only vessels have a length to look up; events and closures resolve to nothing. */
function vesselLengthQuery(
  sql: ReturnType<typeof db>,
  kind: BookingKind,
  vesselId: string | null,
): Promise<{ length_ft: number | null }[]> {
  if (kind !== 'vessel' || !vesselId) return Promise.resolve([]);
  return sql`select length_ft from vessels where id = ${vesselId}` as unknown as Promise<
    { length_ft: number | null }[]
  >;
}

/**
 * Evaluate a candidate booking without writing anything.
 * Uses exactly the same domain functions the importer and the tests use.
 */
export async function checkBooking(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  start: string;
  end: string;
  excludeBookingId?: string;
}): Promise<CheckResult> {
  const sql = db();

  if (!isValidRange({ start: input.start, end: input.end })) {
    return {
      bookable: false,
      conflicts: [],
      fit: null,
      blockedBecause: 'The end date must not be before the start date.',
    };
  }

  // These three lookups are independent of each other, and this runs on every debounced
  // keystroke against a pooler that is a network hop away, so serialising them is felt.
  const [berthRows, rows, vesselRows] = await Promise.all([
    sql`select id, length_ft, capacity_mode from berths where id = ${input.berthId}`,
    sql`
      select id, berth_id, vessel_id, kind, status, label, start_date, end_date
        from bookings
       where berth_id = ${input.berthId}
         and status = 'active'
         and start_date <= ${input.end}::date
         and end_date   >= ${input.start}::date`,
    vesselLengthQuery(sql, input.kind, input.vesselId),
  ]);

  const berth = berthRows[0];
  if (!berth) {
    return { bookable: false, conflicts: [], fit: null, blockedBecause: 'Unknown berth.' };
  }

  const existing: Booking[] = rows.map((r) => ({
    id: r.id as string,
    berthId: r.berth_id as string,
    vesselId: r.vessel_id as string | null,
    kind: r.kind as BookingKind,
    status: 'active',
    label: r.label as string,
    range: {
      start: (r.start_date as Date).toISOString().slice(0, 10),
      end: (r.end_date as Date).toISOString().slice(0, 10),
    },
  }));

  const conflicts = findConflicts(
    { id: input.excludeBookingId, berthId: input.berthId, range: { start: input.start, end: input.end } },
    existing,
    { id: berth.id as string, capacityMode: berth.capacity_mode as 'exclusive' | 'pooled' },
  );

  let fit: FitResult | null = null;
  if (input.kind === 'vessel' && input.vesselId) {
    const v = vesselRows[0];
    fit = checkFit(v?.length_ft ?? null, (berth.length_ft as number | null) ?? null);
  }

  return {
    bookable: conflicts.length === 0,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      label: c.label,
      startDate: c.range.start,
      endDate: c.range.end,
    })),
    fit,
    blockedBecause:
      conflicts.length > 0
        ? `${conflicts[0].label} already holds this berth ${conflicts[0].range.start} to ${conflicts[0].range.end}.`
        : null,
  };
}

/**
 * Find a vessel by name, or register it.
 *
 * The registry has to fill itself through ordinary use. Starting from an empty
 * schedule, every vessel is new, and a booking that stored `vessel_id = null` would
 * leave the Vessels tab permanently empty — so no length could ever be recorded and
 * the fit check could never do anything. Booking a vessel is what puts it on the
 * register; recording its length is then a separate, optional step.
 *
 * Matching is on the same normalized name the importer uses, so 'os/v amber reef'
 * and 'OSV AMBER REEF' are one vessel rather than two.
 */
async function findOrCreateVessel(tx: Queryable, rawName: string): Promise<string | null> {
  const { display, normalized } = canonicalVesselName(rawName);
  if (normalized === '') return null;

  const existing = await (tx as ReturnType<typeof db>)`
    select id from vessels where normalized_name = ${normalized}`;
  if (existing.length > 0) return existing[0].id as string;

  const [created] = await (tx as ReturnType<typeof db>)`
    insert into vessels (canonical_name, normalized_name, length_ft, length_source)
    values (${display}, ${normalized}, null, null)
    on conflict (normalized_name) do update set canonical_name = vessels.canonical_name
    returning id`;
  return created.id as string;
}

export async function createBooking(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  label: string;
  start: string;
  end: string;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sql = db();
  try {
    let id = '';
    await sql.begin(async (tx) => {
      // A vessel booking always resolves to a vessel row; only events and closures
      // legitimately have none.
      const vesselId =
        input.kind === 'vessel' && input.vesselId == null
          ? await findOrCreateVessel(tx, input.label)
          : input.vesselId;

      const [row] = await tx`
        insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date, notes, source)
        values (${input.berthId}, ${vesselId}, ${input.kind}, 'active', ${input.label},
                ${input.start}, ${input.end}, ${input.notes ?? null}, 'manual')
        returning id`;
      id = row.id as string;

      // A booking that does not fit is a review item from the moment it exists, so the
      // queue agrees with the board without waiting for a length to be re-recorded.
      if (input.kind === 'vessel' && vesselId) await refreshTooLongItems(tx, { bookingId: id });
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

export async function cancelBooking(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`update bookings set status = 'cancelled', cancelled_at = now() where id = ${id}`;
      // A cancelled booking occupies nothing, so anything flagged about it is moot.
      // Left open, the queue would accumulate items pointing at bookings that are no
      // longer on the board, and the nav badge would stay inflated.
      await tx`
        update review_items set resolved_at = now()
         where booking_id = ${id} and resolved_at is null`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Put a cancelled booking back.
 *
 * This is the answer to "anyone can cancel anyone's booking" on a public deployment.
 * Restricting the action would need accounts; making it reversible needs one column,
 * and a cancel was already a soft delete, so the row never went anywhere.
 *
 * It restores to `active` and never to `conflict_unresolved`. If the berth was taken
 * in the meantime the EXCLUDE constraint refuses the update, and that refusal is the
 * correct outcome: restoring outside the constraint would put back a double-booking,
 * which is the one thing this system claims cannot happen. So the guarantee is
 * enforced on this path by the same three lines of SQL that enforce it on the others.
 */
export async function restoreBooking(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    let missing = false;
    await sql.begin(async (tx) => {
      const [row] = await tx`
        select cancelled_at from bookings where id = ${id} and status = 'cancelled'`;
      if (!row) { missing = true; return; }

      // Only the items that cancelling closed. Both timestamps were written by the same
      // transaction, so anything resolved by hand beforehand has an earlier resolved_at
      // and stays resolved — the coordinator's decision is not undone by this one.
      if (row.cancelled_at != null) {
        await tx`
          update review_items set resolved_at = null
           where booking_id = ${id} and resolved_at >= ${row.cancelled_at as Date}`;
      }

      await tx`
        update bookings set status = 'active', cancelled_at = null where id = ${id}`;
    });
    if (missing) return { ok: false, error: 'That booking is no longer cancelled.' };
    return { ok: true };
  } catch (e) {
    // The shared message talks about refusing a booking, which is the wrong noun here.
    if ((e as { code?: string }).code === '23P01') {
      return {
        ok: false,
        error: 'Cannot restore: that berth has been booked for those dates since it was cancelled.',
      };
    }
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Recompute the too-long review items for one vessel, or for one booking.
 *
 * Fit is evaluated live on the board but stored in the queue, so the two drift apart
 * unless the queue is refreshed whenever the answer can change. Three things change
 * it: a length is recorded, which touches every booking of that vessel; a booking is
 * moved to another berth; and a booking is created. Each caller passes the narrowest
 * scope it can, so moving one booking does not re-open items a coordinator has
 * already closed on the vessel's other bookings.
 */
async function refreshTooLongItems(
  tx: Queryable,
  scope: { vesselId: string } | { bookingId: string },
) {
  const sql = tx as ReturnType<typeof db>;
  const items = 'vesselId' in scope
    ? sql`vessel_id = ${scope.vesselId}`
    : sql`booking_id = ${scope.bookingId}`;
  const bookings = 'vesselId' in scope
    ? sql`v.id = ${scope.vesselId}`
    : sql`b.id = ${scope.bookingId}`;

  // Clear the open too-long items in scope; they are about to be rebuilt.
  await sql`
    update review_items set resolved_at = now()
     where type = 'too_long' and ${items} and resolved_at is null`;

  // Re-flag every live booking in scope that exceeds its berth.
  await sql`
    insert into review_items (type, booking_id, vessel_id, berth_id, raw_text, detail)
    select 'too_long', b.id, v.id, be.id, v.canonical_name,
           'Vessel is ' || v.length_ft || '''' ||
           ' but the berth is ' || be.length_ft || '''' ||
           ' — over by ' || (v.length_ft - be.length_ft) || '''' ||
           ' (' || b.start_date || '..' || b.end_date || ')'
      from bookings b
      join vessels v on v.id = b.vessel_id
      join berths  be on be.id = b.berth_id
     where ${bookings}
       and b.kind = 'vessel'
       and b.status <> 'cancelled'
       and v.length_ft is not null
       and be.length_ft is not null
       and v.length_ft > be.length_ft`;
}

/**
 * Move a booking to a different berth.
 *
 * The conflict check is the constraint, re-run by the update itself. The fit check is
 * re-run here for the queue: the stored too-long item named the old berth, and left
 * alone it would keep reporting a problem the board no longer shows — or miss the one
 * the move just created.
 */
export async function reassignBooking(
  id: string,
  berthId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`update bookings set berth_id = ${berthId} where id = ${id}`;
      await refreshTooLongItems(tx, { bookingId: id });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/** Recording a length is what turns 'cannot verify' into a real answer. */
export async function setVesselLength(
  vesselId: string,
  lengthFt: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql`
      update vessels
         set length_ft = ${lengthFt},
             length_source = ${lengthFt == null ? null : 'manual'}
       where id = ${vesselId}`;
    // Recording a length answers a question that was previously unanswerable, which
    // may reveal violations that were always there but could not be seen. The
    // missing-length count needs no update: it is derived, not stored.
    await refreshTooLongItems(sql, { vesselId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

export async function resolveReviewItem(id: string): Promise<{ ok: boolean; error?: string }> {
  return resolveReviewItems([id]);
}

/**
 * Resolve a whole group at once.
 *
 * The queue folds repeated rows — one vessel too long for one berth across four
 * bookings is one decision, so marking it done has to close all four. Resolving them
 * one at a time would leave the group half-present on the next render.
 */
export async function resolveReviewItems(
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: true };
  const sql = db();
  try {
    await sql`
      update review_items set resolved_at = now()
       where id = any(${ids}::uuid[]) and resolved_at is null`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Keep what is about to be replaced, so the action replacing it can be undone.
 *
 * Called first inside every action that replaces the whole schedule — Clear and Load —
 * in that action's own transaction, so the snapshot and the replacement commit or fail
 * together. It holds one schedule: the last non-empty one an action replaced.
 *
 * An empty schedule has nothing to lose, so it leaves the existing snapshot alone. That
 * is the case that matters most: Clear followed by an accidental Load must still be able
 * to put back what was there before the Clear, and overwriting the snapshot with an
 * empty one would throw that away.
 */
async function snapshotForUndo(tx: Queryable, kind: 'clear' | 'load') {
  const sql = tx as ReturnType<typeof db>;
  const raw = (cols: string) => db().unsafe(cols);
  const [live] = await sql`
    select (select count(*)::int from bookings) as bookings,
           (select count(*)::int from vessels)  as vessels`;
  if ((live.bookings as number) === 0 && (live.vessels as number) === 0) return;

  await sql`delete from review_items_undo`;
  await sql`delete from bookings_undo`;
  await sql`delete from vessels_undo`;
  await sql`insert into vessels_undo select ${raw(VESSEL_COLS)} from vessels`;
  await sql`insert into bookings_undo select ${raw(BOOKING_COLS)} from bookings`;
  await sql`insert into review_items_undo select ${raw(REVIEW_COLS)} from review_items`;
  await sql`
    insert into undo_meta (id, taken_at, bookings, vessels, kind)
    values (1, now(), ${live.bookings as number}, ${live.vessels as number}, ${kind})
    on conflict (id) do update
      set taken_at = excluded.taken_at, bookings = excluded.bookings,
          vessels  = excluded.vessels,  kind     = excluded.kind`;
}

/**
 * Restore the sample: the `*_seed` snapshot taken when the workbook was imported.
 *
 * Every row is the client's own. An earlier version added bookings around today with
 * invented dates, so the board opened on a busy month; it was removed as clutter and as
 * the one place the app showed data nobody had entered (DECISIONS 29).
 *
 * It replaces the whole schedule, so it snapshots first and can be undone — it used to
 * delete visitors' bookings outright and throw away the Clear undo as well.
 *
 * The app is public and unauthenticated by design, so anyone can edit it — this is
 * what makes that safe to offer: whatever a visitor does, one action puts the sample
 * back. Restoring from a snapshot is faster and more reliable than re-parsing the
 * workbook inside a serverless function, and at roughly 12 seconds it is why the
 * routes that host it raise `maxDuration`.
 */
export async function resetToImported(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await snapshotForUndo(tx, 'load');
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
      await tx`delete from berths`;
      await tx`insert into berths       select * from berths_seed`;
      await tx`insert into vessels      select * from vessels_seed`;
      // Columns are listed explicitly because `during` is a GENERATED column and
      // Postgres refuses to have one written to. `select *` would include it.
      await tx`
        insert into bookings (
          id, berth_id, vessel_id, kind, status, label, start_date, end_date,
          exclusive, notes, source, import_year, import_sheet, import_row, import_col,
          created_at)
        select
          id, berth_id, vessel_id, kind, status, label, start_date, end_date,
          exclusive, notes, source, import_year, import_sheet, import_row, import_col,
          created_at
        from bookings_seed`;
      await tx`insert into review_items select * from review_items_seed`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Empty the schedule, keeping the berths.
 *
 * Everything it deletes is copied into the `*_undo` tables first, in the same
 * transaction, so the delete and its snapshot cannot come apart: if the copy fails
 * nothing is removed, and if the delete fails the snapshot rolls back with it. That
 * is what makes this the last destructive action in the app to become reversible, and
 * it is why invariant 12 no longer carries an exception.
 *
 * Berths survive because they are the facility itself — without them there are no lanes
 * to book into and the board has nothing to draw. They are defined in a migration.
 */
export async function clearSchedule(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await snapshotForUndo(tx, 'clear');
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Put back the schedule the last Clear or Load replaced.
 *
 * Restoring replaces the current schedule rather than merging into it, because both
 * actions it undoes are all-or-nothing and undoing one should land you exactly where you
 * were. The snapshot is consumed on the way out: an undo you can run twice would quietly
 * wipe work done since the first one.
 */
export async function restorePrevious(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    let empty = false;
    await sql.begin(async (tx) => {
      const [meta] = await tx`select bookings from undo_meta where id = 1`;
      if (!meta) { empty = true; return; }

      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;

      await tx`insert into vessels (${sql.unsafe(VESSEL_COLS)}) select ${sql.unsafe(VESSEL_COLS)} from vessels_undo`;
      await tx`insert into bookings (${sql.unsafe(BOOKING_COLS)}) select ${sql.unsafe(BOOKING_COLS)} from bookings_undo`;
      await tx`insert into review_items (${sql.unsafe(REVIEW_COLS)}) select ${sql.unsafe(REVIEW_COLS)} from review_items_undo`;

      await tx`delete from review_items_undo`;
      await tx`delete from bookings_undo`;
      await tx`delete from vessels_undo`;
      await tx`delete from undo_meta`;
    });
    if (empty) return { ok: false, error: 'There is no previous schedule to put back.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Throw the snapshot away without restoring it.
 *
 * For operator resets — `npm run sample:load` and the test suite's teardown — which put
 * the live site back to its shipped state and must not leave a "put back" offer behind
 * pointing at whatever was there before, test bookings included.
 */
export async function discardPreviousSchedule(): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`delete from review_items_undo`;
    await tx`delete from bookings_undo`;
    await tx`delete from vessels_undo`;
    await tx`delete from undo_meta`;
  });
}

/** Turn a Postgres error into something a dock coordinator can act on. */
function describeDbError(e: unknown): string {
  const err = e as { code?: string; constraint_name?: string; message?: string };
  if (err.code === '23P01') {
    return 'That berth is already occupied for part of those dates. The database refused the booking.';
  }
  if (err.code === '23514') {
    return 'Those dates are not valid for a booking.';
  }
  if (err.code === '22000') {
    return 'The end date must not be before the start date.';
  }
  return err.message ?? 'The database rejected that change.';
}
