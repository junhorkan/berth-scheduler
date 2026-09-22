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
import { nothingToLose } from '../lib/undo';
import type { Schedule } from '../lib/undo';
import { todayISO } from '../lib/nav';
import type { ImportPlan } from '../import/plan';
import { randomUUID } from 'node:crypto';

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
/** `bookings_seed` was taken before `cancelled_at` existed, so it is read without it. */
const SEED_BOOKING_COLS =
  'id, berth_id, vessel_id, kind, status, label, start_date, end_date, exclusive, '
  + 'notes, source, import_year, import_sheet, import_row, import_col, created_at';
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
  // The form refuses a past start too, but that only stops people using the form: the
  // action behind it is a public endpoint. This is the check for anything that calls it
  // directly, which the form's `min` and its disabled Save button cannot be.
  if (input.start < todayISO()) {
    return { ok: false, error: 'A berth cannot be reserved for a day that has already passed.' };
  }
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

/*
 * The schedule replacements — Clear, Load and Put back — and the one snapshot slot that
 * makes each of them undoable.
 *
 * The POLICY is `src/lib/undo.ts`, pure and tested against every sequence of actions:
 * an action saves what it replaces, unless that has nothing to lose. Everything below
 * carries that out, and each replace takes the same steps inside one transaction, so a
 * failure anywhere leaves the schedule and its snapshot exactly as they were:
 *
 *   1. lock      serialise with any other replace, and hold off concurrent writes
 *   2. assess    does the live schedule have anything to lose?  (nothingToLose, shared)
 *   3. snapshot  if so, save it
 *   4. replace   delete the live rows and write the new ones
 *
 * DECISIONS 28–30 have the history, including the Put back that deleted the live
 * schedule without saving it.
 */

/**
 * Serialise every replace, and hold off writes while one runs.
 *
 * With no lock, two replaces that overlapped each copied the committed live rows into
 * the snapshot, so it held every row twice and putting it back failed on the live
 * tables' primary keys, every time; and a booking saved between a replace's snapshot and
 * its delete was deleted without being snapshotted. EXCLUSIVE mode blocks writes but not
 * reads, so the board keeps rendering while a Load runs. `lock_timeout` turns a lock
 * that never comes into a clear failure instead of a hang against the time limit.
 */
async function lockSchedule(tx: Queryable) {
  const sql = tx as ReturnType<typeof db>;
  await sql`set local lock_timeout = '10s'`;
  await sql`lock table review_items, bookings, vessels in exclusive mode`;
}

/**
 * What the undo policy needs to know about the live schedule.
 *
 * `active` counts bookings that are not cancelled — the test the board uses to call the
 * schedule empty, so the two can never disagree about whether there is anything to lose.
 * `isSample` is true when the live schedule is exactly the seed, compared on every
 * column a person can change here: a booking's berth and status, a vessel's length, a
 * review item's resolution, and any row added or removed. Load can always make that
 * again, so it has nothing to lose.
 */
async function liveSchedule(tx: Queryable): Promise<Schedule> {
  const sql = tx as ReturnType<typeof db>;
  const [{ active }] = await sql`
    select count(*)::int as active from bookings where status <> 'cancelled'`;
  const [{ has_seed }] = await sql`
    select to_regclass('public.bookings_seed') is not null as has_seed`;
  if (!has_seed) return { id: 'live', active: active as number, isSample: false };

  const [{ is_sample }] = await sql`
    select
          (select count(*) from bookings)     = (select count(*) from bookings_seed)
      and (select count(*) from vessels)      = (select count(*) from vessels_seed)
      and (select count(*) from review_items) = (select count(*) from review_items_seed)
      and not exists (
        select id, berth_id, vessel_id, kind, status, label, start_date, end_date from bookings
        except
        select id, berth_id, vessel_id, kind, status, label, start_date, end_date from bookings_seed)
      and not exists (
        select id, canonical_name, length_ft from vessels
        except
        select id, canonical_name, length_ft from vessels_seed)
      and not exists (
        select id, type, booking_id, resolved_at from review_items
        except
        select id, type, booking_id, resolved_at from review_items_seed)
      as is_sample`;
  return { id: 'live', active: active as number, isSample: is_sample === true };
}

/** Empty the snapshot slot. */
async function emptySnapshot(tx: Queryable) {
  const sql = tx as ReturnType<typeof db>;
  await sql`delete from review_items_undo`;
  await sql`delete from bookings_undo`;
  await sql`delete from vessels_undo`;
  await sql`delete from undo_meta`;
}

/** Put the live schedule in the snapshot slot, recording which action took it. */
async function saveSnapshot(tx: Queryable, kind: 'clear' | 'load' | 'restore') {
  const sql = tx as ReturnType<typeof db>;
  const raw = (cols: string) => db().unsafe(cols);
  await emptySnapshot(sql);
  await sql`insert into vessels_undo select ${raw(VESSEL_COLS)} from vessels`;
  await sql`insert into bookings_undo select ${raw(BOOKING_COLS)} from bookings`;
  await sql`insert into review_items_undo select ${raw(REVIEW_COLS)} from review_items`;
  await sql`
    insert into undo_meta (id, taken_at, bookings, vessels, kind)
    values (1, now(), (select count(*)::int from bookings),
            (select count(*)::int from vessels), ${kind})`;
}

/** Delete the live schedule. Berths stay: they are the facility, defined in a migration. */
async function emptyLive(tx: Queryable) {
  const sql = tx as ReturnType<typeof db>;
  await sql`delete from review_items`;
  await sql`delete from bookings`;
  await sql`delete from vessels`;
}

/**
 * Restore the sample: the `*_seed` snapshot taken when the workbook was imported.
 *
 * Every row is the client's own. The berths are not touched: they are the facility and
 * live in a migration, and the seed's bookings reference those same ids. This used to
 * delete the berths and re-insert them from `berths_seed`, which only worked because the
 * ids happened to match; if they ever differ, the insert below now fails on its foreign
 * key and rolls everything back, loudly, instead.
 */
export async function resetToImported(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const raw = (cols: string) => sql.unsafe(cols);
  try {
    await sql.begin(async (tx) => {
      await lockSchedule(tx);
      if (!nothingToLose(await liveSchedule(tx))) await saveSnapshot(tx, 'load');
      await emptyLive(tx);
      await tx`insert into vessels (${raw(VESSEL_COLS)}) select ${raw(VESSEL_COLS)} from vessels_seed`;
      // `during` is GENERATED and cannot be written to, which is why the columns are
      // listed rather than `select *`.
      await tx`insert into bookings (${raw(SEED_BOOKING_COLS)}) select ${raw(SEED_BOOKING_COLS)} from bookings_seed`;
      await tx`insert into review_items (${raw(REVIEW_COLS)}) select ${raw(REVIEW_COLS)} from review_items_seed`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/** Empty the schedule, keeping the berths. */
export async function clearSchedule(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await lockSchedule(tx);
      if (!nothingToLose(await liveSchedule(tx))) await saveSnapshot(tx, 'clear');
      await emptyLive(tx);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Put back the schedule in the snapshot — as a swap.
 *
 * What is live now goes into the snapshot, unless it has nothing to lose, so Put back
 * can never destroy work and pressing it again undoes it. It used to delete the live
 * schedule outright: after a Load, days of bookings made on the sample could be wiped by
 * anyone with one click and no way back. The snapshot is held aside in temp tables
 * first, because step 3 is about to overwrite the slot it lives in.
 */
export async function restorePrevious(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const raw = (cols: string) => sql.unsafe(cols);
  try {
    let refused = false;
    await sql.begin(async (tx) => {
      await lockSchedule(tx);
      const [meta] = await tx`select 1 from undo_meta where id = 1`;
      if (!meta) { refused = true; return; }

      await tx`create temp table put_back_vessels      on commit drop as select * from vessels_undo`;
      await tx`create temp table put_back_bookings     on commit drop as select * from bookings_undo`;
      await tx`create temp table put_back_review_items on commit drop as select * from review_items_undo`;

      if (nothingToLose(await liveSchedule(tx))) await emptySnapshot(tx);
      else await saveSnapshot(tx, 'restore');

      await emptyLive(tx);
      await tx`insert into vessels (${raw(VESSEL_COLS)}) select ${raw(VESSEL_COLS)} from put_back_vessels`;
      await tx`insert into bookings (${raw(BOOKING_COLS)}) select ${raw(BOOKING_COLS)} from put_back_bookings`;
      await tx`insert into review_items (${raw(REVIEW_COLS)}) select ${raw(REVIEW_COLS)} from put_back_review_items`;
    });
    if (refused) return { ok: false, error: 'There is no previous schedule to put back.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Replace the schedule with an import plan, and make it the new sample.
 *
 * The command-line importer used to do this as a run of separate statements with no
 * transaction: it truncated the berths, rebuilt everything, then dropped and re-created
 * the seed tables. A parse that came back empty would truncate the live site and then
 * fail, leaving no bookings, no berths and no undo; a partial parse would overwrite the
 * seed — the only backstop — with the reduced set, and exit cleanly.
 *
 * Now it is one transaction under the same lock as every other replace, it follows the
 * same undo rule as Load, and it never touches the berths: each row is mapped by name
 * onto the facility's seven, and a berth the facility does not have refuses the import.
 * An empty plan cannot reach here — planImport() refuses it first — but this checks too.
 */
export async function writeImportPlan(
  plan: ImportPlan,
): Promise<{ ok: true; bookings: number; vessels: number; reviewItems: number } | { ok: false; error: string }> {
  if (plan.bookings.length === 0) return { ok: false, error: 'The plan holds no bookings; nothing was written.' };
  const sql = db();
  const raw = (cols: string) => sql.unsafe(cols);
  try {
    await sql.begin(async (tx) => {
      await lockSchedule(tx);

      const live = await tx`select id, name from berths`;
      const berthId = new Map(live.map((b) => [b.name as string, b.id as string]));
      const unknown = plan.berths.map((b) => b.name).filter((n) => !berthId.has(n));
      if (unknown.length) {
        throw new Error(`The workbook names a berth this facility does not have: ${unknown.join(', ')}.`);
      }

      if (!nothingToLose(await liveSchedule(tx))) await saveSnapshot(tx, 'load');
      await emptyLive(tx);

      const vesselId = new Map(plan.vessels.map((v) => [v.normalized, randomUUID()]));
      const bookingId = plan.bookings.map(() => randomUUID());

      const vesselRows = plan.vessels.map((v) => ({
        id: vesselId.get(v.normalized)!, canonical_name: v.display, normalized_name: v.normalized,
        length_ft: v.lengthFt, loa_ft: v.loaFt, length_source: v.lengthSource, operator: v.operator,
      }));
      for (let i = 0; i < vesselRows.length; i += 250) {
        await tx`insert into vessels ${sql(vesselRows.slice(i, i + 250))}`;
      }

      const bookingRows = plan.bookings.map((b, i) => {
        const at = b.provenance[0];
        return {
          id: bookingId[i], berth_id: berthId.get(b.berthName)!,
          vessel_id: b.normalizedVesselName ? vesselId.get(b.normalizedVesselName) ?? null : null,
          kind: b.kind, status: b.status, label: b.label, start_date: b.start, end_date: b.end,
          notes: b.conflictWith ? `Imported overlap with ${b.conflictWith}` : null,
          source: 'import', import_year: Number(at.sheet), import_sheet: at.sheet,
          import_row: at.row, import_col: at.col,
        };
      });
      // The exclusion constraint audits the plan's own conflict classification: an
      // overlap left 'active' fails this insert and rolls the whole import back.
      for (let i = 0; i < bookingRows.length; i += 250) {
        await tx`insert into bookings ${sql(bookingRows.slice(i, i + 250))}`;
      }

      const itemRows = plan.reviewItems.map((r) => ({
        type: r.type,
        booking_id: r.bookingIndex != null ? bookingId[r.bookingIndex] : null,
        vessel_id: r.vesselNormalized ? vesselId.get(r.vesselNormalized) ?? null : null,
        berth_id: r.berthName ? berthId.get(r.berthName) ?? null : null,
        raw_text: r.rawText, detail: r.detail, import_year: r.importYear,
        import_sheet: r.importSheet, import_row: r.importRow, import_col: r.importCol,
      }));
      for (let i = 0; i < itemRows.length; i += 250) {
        await tx`insert into review_items ${sql(itemRows.slice(i, i + 250))}`;
      }

      // The new sample, in the same transaction: if anything above failed, the seed is
      // untouched. Rows are replaced rather than the tables dropped, so the keys and
      // row-level security the migrations gave them survive.
      await tx`delete from review_items_seed`;
      await tx`delete from bookings_seed`;
      await tx`delete from vessels_seed`;
      await tx`delete from berths_seed`;
      await tx`insert into berths_seed select * from berths`;
      await tx`insert into vessels_seed (${raw(VESSEL_COLS)}) select ${raw(VESSEL_COLS)} from vessels`;
      await tx`insert into bookings_seed (${raw(SEED_BOOKING_COLS)}) select ${raw(SEED_BOOKING_COLS)} from bookings`;
      await tx`insert into review_items_seed (${raw(REVIEW_COLS)}) select ${raw(REVIEW_COLS)} from review_items`;
    });
    return {
      ok: true, bookings: plan.bookings.length, vessels: plan.vessels.length,
      reviewItems: plan.reviewItems.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && !('code' in e) ? e.message : describeDbError(e) };
  }
}

/**
 * Throw the snapshot away without restoring it.
 *
 * For operator resets — `npm run sample:load`, `npm run import`, and the test suite's
 * teardown — which put the live site back to its shipped state and must not leave a
 * "put back" offer behind pointing at whatever was there before, test bookings included.
 */
export async function discardPreviousSchedule(): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    await lockSchedule(tx);
    await emptySnapshot(tx);
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
