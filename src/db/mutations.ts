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
import { dateSampleBookings } from '../lib/sample';
import { todayISO } from '../lib/nav';

/**
 * A connection or a transaction. The helpers below run inside either, and are cast to
 * the connection type internally because the two are called identically but do not
 * share a declared call signature.
 */
type Queryable = ReturnType<typeof db> | postgres.TransactionSql;

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
 * The sample's forward bookings, dated from today.
 *
 * Names resolve against the register the seed just restored, and a name that does not
 * resolve is a bug in `lib/sample`, so it fails the reload loudly rather than skipping
 * the row. The one that does not fit its berth gets its review item here, the same way
 * a booking made through the form would.
 */
async function insertSampleBookings(tx: Queryable, today: string) {
  const sql = tx as ReturnType<typeof db>;
  for (const b of dateSampleBookings(today)) {
    let vesselId: string | null = null;
    if (b.kind === 'vessel') {
      const [v] = await sql`
        select id from vessels where normalized_name = ${canonicalVesselName(b.label).normalized}`;
      if (!v) throw new Error(`The sample names a vessel that is not on the register: ${b.label}`);
      vesselId = v.id as string;
    }
    const [row] = await sql`
      insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date, source)
      select be.id, ${vesselId}, ${b.kind}, 'active', ${b.label},
             ${b.start}::date, ${b.end}::date, 'sample'
        from berths be where be.name = ${b.berth}
      returning id`;
    if (!row) throw new Error(`The sample names a berth that does not exist: ${b.berth}`);
    if (vesselId) await refreshTooLongItems(sql, { bookingId: row.id as string });
  }
}

/**
 * Restore the sample: the `*_seed` snapshot taken at import time, plus the bookings
 * in the coming weeks, dated from today (DECISIONS 25).
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
      await insertSampleBookings(tx, todayISO());
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Empty the schedule, keeping the berths.
 *
 * This is the one irreversible action in the app, and its dialog says so: a booking
 * made here is deleted outright, not soft-deleted like a cancellation. Berths survive
 * because they are the facility itself — without them there are no lanes to book
 * into and the board has nothing to draw. They are defined in a migration, not
 * created here.
 */
export async function clearSchedule(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
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
