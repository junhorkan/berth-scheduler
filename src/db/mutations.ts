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
import { findConflicts, findVesselClashes, isValidRange } from '../domain/conflicts';
import { checkFit, type FitResult } from '../domain/fit';
import { canonicalVesselName } from '../domain/normalize';
import type { Booking, BookingKind } from '../domain/types';
import { nothingToLose } from '../lib/undo';
import type { Schedule } from '../lib/undo';
import { todayISO, lastBookableISO, isBookingId } from '../lib/nav';
import { parseLengthFt } from '../lib/length';
import { checkMove } from '../domain/move';
import { checkEdit, cleanNotes, vesselLinkFor } from '../domain/edit';
import { hasEnded, ENDED_REFUSAL } from '../domain/record';
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
/**
 * `text` has no length, so these are the app's. A label is a vessel's name or an event's
 * description and a note is a sentence or two; ten thousand characters of either is not
 * a long name, it is someone writing on the board.
 */
const MAX_LABEL_CHARS = 200;
const MAX_NOTES_CHARS = 2000;

const REVIEW_COLS =
  'id, type, booking_id, vessel_id, berth_id, raw_text, detail, import_year, '
  + 'import_sheet, import_row, import_col, resolved_at, created_at';

export type CheckResult = {
  bookable: boolean;
  /** Hard stop: overlapping bookings on this berth. */
  conflicts: { id: string; label: string; startDate: string; endDate: string }[];
  /** Advisory only. Never blocks. */
  fit: FitResult | null;
  /**
   * Advisory only, and never blocking for the reason in domain/conflicts: the same hull
   * booked at a DIFFERENT berth over these days. The berth's name is carried because
   * the domain knows berths by id only, and a warning that names an id helps nobody.
   */
  vesselClashes: {
    id: string;
    berthName: string;
    startDate: string;
    endDate: string;
    /** One day reads as a berth shift; two or more cannot. The wording turns on this. */
    sharedDays: number;
    /** The first day both cover — the day itself when there is only one. */
    sharedStart: string;
  }[];
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

/** A same-vessel booking on some other berth, with that berth's name for the wording. */
type ElsewhereRow = {
  id: string;
  berth_id: string;
  vessel_id: string | null;
  kind: BookingKind;
  label: string;
  start_date: Date;
  end_date: Date;
  berth_name: string;
};

/**
 * The same hull's other engagements over these days.
 *
 * `berth_id <>` leaves out this berth on purpose: an overlap there is the hard conflict,
 * which the query above already finds and the constraint already refuses. Events and
 * closures have no vessel, so there is nothing to ask about and no query to run.
 */
function vesselElsewhereQuery(
  sql: ReturnType<typeof db>,
  kind: BookingKind,
  vesselId: string | null,
  berthId: string,
  start: string,
  end: string,
): Promise<ElsewhereRow[]> {
  if (kind !== 'vessel' || !vesselId) return Promise.resolve([]);
  return sql`
    select b.id, b.berth_id, b.vessel_id, b.kind, b.label, b.start_date, b.end_date,
           be.name as berth_name
      from bookings b
      join berths be on be.id = b.berth_id
     where b.vessel_id = ${vesselId}
       and b.berth_id <> ${berthId}
       and b.status = 'active'
       and b.start_date <= ${end}::date
       and b.end_date   >= ${start}::date
     order by b.start_date` as unknown as Promise<ElsewhereRow[]>;
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
  /**
   * A length being typed into the booking form for a vessel that has none recorded —
   * including one being registered by this very booking, which has no row to look up.
   *
   * It overrides the stored value for THIS check only; nothing is written until the
   * booking saves. The fit sentence has one author either way: `checkFit`, here, on
   * the server — computing a second opinion in the component is how the board and the
   * form start disagreeing about the same vessel.
   */
  vesselLengthFt?: number | null;
}): Promise<CheckResult> {
  const sql = db();

  /*
    Ids checked before SQL, and for the same reason the board checks `sel`: a non-uuid
    reaching `where id = $1` is a `22P02` thrown out of this function, out of the action,
    and into a client that awaits it without a catch — the same shape as the 500 the
    board once answered. `checkBooking` runs on every debounced keystroke, so it is the
    most-called endpoint in the app and had no guard at all.
  */
  if (!isBookingId(input.berthId)) {
    return {
      bookable: false, conflicts: [], fit: null, vesselClashes: [], blockedBecause: 'Unknown berth.',
    };
  }
  if ((input.vesselId != null && !isBookingId(input.vesselId))
      || (input.excludeBookingId != null && !isBookingId(input.excludeBookingId))) {
    return {
      bookable: false, conflicts: [], fit: null, vesselClashes: [],
      blockedBecause: 'That booking or vessel could not be found.',
    };
  }

  if (!isValidRange({ start: input.start, end: input.end })) {
    return {
      bookable: false,
      conflicts: [],
      fit: null,
      vesselClashes: [],
      blockedBecause: 'The end date must not be before the start date.',
    };
  }

  // These four lookups are independent of each other, and this runs on every debounced
  // keystroke against a pooler that is a network hop away, so serialising them is felt.
  const [berthRows, rows, vesselRows, elsewhereRows] = await Promise.all([
    sql`select id, length_ft, capacity_mode from berths where id = ${input.berthId}`,
    sql`
      select id, berth_id, vessel_id, kind, status, label, start_date, end_date
        from bookings
       where berth_id = ${input.berthId}
         and status = 'active'
         and start_date <= ${input.end}::date
         and end_date   >= ${input.start}::date`,
    vesselLengthQuery(sql, input.kind, input.vesselId),
    vesselElsewhereQuery(sql, input.kind, input.vesselId, input.berthId, input.start, input.end),
  ]);

  const berth = berthRows[0];
  if (!berth) {
    return {
      bookable: false, conflicts: [], fit: null, vesselClashes: [], blockedBecause: 'Unknown berth.',
    };
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
  if (input.kind === 'vessel') {
    // A typed length beats the stored one, and is the only length a brand-new vessel
    // has — so the fit check answers for a hull that is not on the register yet.
    const stored = vesselRows[0]?.length_ft ?? null;
    const known = input.vesselLengthFt ?? stored;
    // Still nothing known and no vessel row: there is no question to answer.
    if (input.vesselId || known != null) {
      fit = checkFit(known, (berth.length_ft as number | null) ?? null);
    }
  }

  const elsewhere: Booking[] = elsewhereRows.map((r) => ({
    id: r.id,
    berthId: r.berth_id,
    vesselId: r.vessel_id,
    kind: r.kind,
    status: 'active',
    label: r.label,
    range: {
      start: r.start_date.toISOString().slice(0, 10),
      end: r.end_date.toISOString().slice(0, 10),
    },
  }));
  const berthNameOf = new Map(elsewhereRows.map((r) => [r.id, r.berth_name]));
  const vesselClashes = findVesselClashes(
    {
      id: input.excludeBookingId,
      berthId: input.berthId,
      vesselId: input.vesselId,
      range: { start: input.start, end: input.end },
    },
    elsewhere,
  ).map((c) => ({
    id: c.booking.id,
    // The other booking's own label is left out: for a vessel booking it is the hull's
    // name, which both panels have already said on screen before this line is reached.
    berthName: berthNameOf.get(c.booking.id) ?? '',
    startDate: c.booking.range.start,
    endDate: c.booking.range.end,
    sharedDays: c.sharedDays,
    sharedStart: c.shared.start,
  }));

  return {
    // `vesselClashes` is absent from this line on purpose. It is advisory, and a hull in
    // two places is a question for a person, not a refusal from a form (DECISIONS 2).
    bookable: conflicts.length === 0,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      label: c.label,
      startDate: c.range.start,
      endDate: c.range.end,
    })),
    fit,
    vesselClashes,
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
  /**
   * A length recorded at the moment of booking, which is the moment somebody actually
   * knows it — reading the email that says "118ft LOA, arriving the 14th".
   *
   * 20 of 418 vessels in the source have a length, so the fit check is silent on 97%
   * of bookings, and the only place to close that gap was a register page somebody had
   * to choose to visit and type into 398 rows. Nobody does that work. Booking collected
   * the name and threw the measurement away.
   */
  vesselLengthFt?: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  /*
    The form refuses these too, but that only stops people using the form: the action
    behind it is a public endpoint. This is the check for anything that calls it
    directly, which the form's `min`/`max` and its disabled Save button cannot be.

    The shape checks come first, because a TypeScript signature is not a runtime promise
    and every one of these was reachable:

      - `kind` outside the three reached a CHECK and came back as a date complaint.
      - `start: undefined` passed BOTH date guards below — `undefined < today` is false
        and so is `undefined > ceiling` — and then failed NOT NULL, which the mapper read
        as an unknown berth. A comparison against undefined is false either way, so a
        missing date sailed through two checks written to catch a wrong one.
      - an event carrying a `vesselId` stored fine: the schema only requires a vessel for
        `kind = 'vessel'`, and the register joins bookings without filtering on kind, so
        a hull appeared on the register through a booking that was not a vessel booking.
      - a label of ten thousand characters stored fine, `text` having no bound.

    `checkEdit` is the same rule `updateBooking` already applies, so the two paths refuse
    an unnamed booking in the same words instead of one of them accepting it.
  */
  // Checked before it reaches SQL, the way `sel` is on the board: a berth id that is not
  // a uuid is a `22P02` parse error from Postgres, and no sentence built from that tells
  // anyone anything. An id that IS a uuid but names no berth is answered further down.
  if (!isBookingId(input.berthId)) return { ok: false, error: 'That berth does not exist.' };
  if (input.vesselId != null && !isBookingId(input.vesselId)) {
    return { ok: false, error: 'That vessel does not exist.' };
  }
  if (input.kind !== 'vessel' && input.kind !== 'event' && input.kind !== 'closure') {
    return { ok: false, error: 'A booking is a vessel, an event or a closure.' };
  }
  if (typeof input.start !== 'string' || typeof input.end !== 'string'
      || !isValidRange({ start: input.start, end: input.end })) {
    return { ok: false, error: 'A booking needs a start and an end, and the end cannot be first.' };
  }
  const named = checkEdit({ kind: input.kind, label: String(input.label ?? '') });
  if (!named.ok) return { ok: false, error: named.error };
  if (String(input.label).length > MAX_LABEL_CHARS || (input.notes ?? '').length > MAX_NOTES_CHARS) {
    return { ok: false, error: 'That name or note is too long.' };
  }
  if (input.start < todayISO()) {
    return { ok: false, error: 'A berth cannot be reserved for a day that has already passed.' };
  }
  // Without a ceiling a booking can be stored past the board's furthest navigable
  // month, where nothing can reach it: the empty-month pointer names its year, and
  // following the link clamps back short of it, which is a loop around a row you
  // cannot open. `lastYear` now stretches to cover such a row if one already exists;
  // this is what stops another being made. Invariant 7.
  if (input.end > lastBookableISO()) {
    return {
      ok: false,
      error: `The schedule only takes bookings up to ${lastBookableISO().slice(0, 4)}.`,
    };
  }

  /*
    The length is re-read here for the same reason the dates are: the form parses it
    with lib/length, and the form is not the guard — this action is a public endpoint.
    Called directly with 987654 it stored 987654, and the queue duly reported a vessel
    "over by 987599 feet". A bogus length is worse than no length, because it turns
    "cannot verify" into a confident wrong answer — which is the one thing `lib/length`
    exists to prevent, in the one place it was not running.
  */
  let length: number | null = null;
  if (input.vesselLengthFt != null) {
    const parsed = parseLengthFt(String(input.vesselLengthFt));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    length = parsed.value;
  }
  const sql = db();
  try {
    let id = '';
    await sql.begin(async (tx) => {
      // A vessel booking always resolves to a vessel row; only events and closures
      // legitimately have none.
      const vesselId =
        /*
          `kind` decides first, and that ordering is the fix.

          It used to ask only whether a vessel id was absent, so an EVENT carrying one
          kept it: the CHECK constraint requires a vessel for `kind = 'vessel'` and says
          nothing about the other two, and `getVessels` INNER JOINs bookings WITHOUT
          filtering on kind — so a hull appeared on the register through a booking that
          was not a vessel booking, which makes invariant 2's register lie. Only this
          path could introduce it; `updateBooking` clears through `vesselLinkFor`.
        */
        input.kind !== 'vessel'
          ? null
          : input.vesselId ?? await findOrCreateVessel(tx, input.label);

      const [row] = await tx`
        insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date, notes, source)
        values (${input.berthId}, ${vesselId}, ${input.kind}, 'active', ${input.label},
                ${input.start}, ${input.end}, ${cleanNotes(input.notes)}, 'manual')
        returning id`;
      id = row.id as string;

      /*
        Record the length, but only onto a vessel that has none.

        Never an overwrite: a booking form is not where a recorded measurement gets
        revised, and silently replacing one from here would corrupt the single column
        this system's second check depends on. Correcting a known length stays a
        deliberate act on the Vessels page.
      */
      if (input.kind === 'vessel' && vesselId && length != null) {
        await tx`
          update vessels
             set length_ft = ${length}, length_source = 'manual'
           where id = ${vesselId} and length_ft is null`;
      }

      // A booking that does not fit is a review item from the moment it exists, so the
      // queue agrees with the board without waiting for a length to be re-recorded.
      // Runs after the length is written, so a length given here is already in force.
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
    // Cancelling an ended booking is not a cancellation — the vessel already came and
    // went. It is a deletion from the record, and it takes the row off the board along
    // with its provenance, so the rule that closes editing has to close this too
    // (domain/record). Checked on the server because the action is a public endpoint.
    const [existing] = await sql`select end_date::text, status from bookings where id = ${id}`;
    if (!existing) return { ok: false, error: 'That booking no longer exists.' };
    if (hasEnded(existing.end_date as string, todayISO())) {
      return { ok: false, error: ENDED_REFUSAL };
    }
    /*
      Cancelling a cancelled booking is not a no-op, which is why it has to be refused
      rather than allowed to fall through harmlessly.

      The undo depends on cancel writing `cancelled_at` and its items' `resolved_at` from
      the SAME `now()`, so `restoreBooking` can re-open exactly the items this cancel
      closed with `resolved_at >= cancelled_at`. A second cancel restamps `cancelled_at`
      to a later time, while the items keep the first one — and the comparison is then
      false forever. Restore would put the booking back and leave its conflicts and
      misfits closed for good.

      Reachable by a retried request or a direct call, so the guard belongs here.
    */
    if (existing.status === 'cancelled') {
      return { ok: false, error: 'That booking is already cancelled.' };
    }

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
           'Vessel is ' || v.length_ft || 'ft' ||
           ' but the berth is ' || be.length_ft || 'ft' ||
           ' — over by ' || (v.length_ft - be.length_ft) || 'ft' ||
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
 * Update a booking: its berth, its dates, what it is called, what kind of thing it is,
 * and the coordinator's note — any of them, in one transaction.
 *
 * The conflict check is the constraint, re-run by the update itself — `during` is a
 * generated column, so changing either date re-evaluates the exclusion exactly as
 * changing the berth does. Moving into an occupied slot is refused by the database on
 * this path for the same reason it is refused on an insert, and there is no override.
 *
 * Everything here exists for the same reason the dates do: the alternative is
 * cancel-and-rebook, which loses the row's identity, its import provenance
 * (`imported from sheet 2010, row 75` becomes `entered in this system`) and the review
 * items hanging off it, and leaves two bookings where the facility has one. That trade
 * was refused for a mistyped date; a mistyped vessel name is the same trade.
 *
 * The fit check is re-run here for the queue: the stored too-long item named the old
 * berth, the old span and the old vessel, and left alone it would keep reporting a
 * problem the board no longer shows — or miss the one this write just created. A booking
 * that has stopped being a vessel loses its item outright, since nothing is being
 * measured any more.
 */
export async function updateBooking(
  id: string,
  to: {
    berthId: string;
    start: string;
    end: string;
    label: string;
    kind: BookingKind;
    notes: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    // Where it sits now decides whether this is scheduling or correcting the record, and
    // what it is linked to now decides whether the name has to be re-resolved — so the
    // rules need the stored row, and this is the check for anything calling the action
    // directly, which the panel's disabled button cannot be.
    const [row] = await sql`
      select start_date::text, end_date::text, kind, label, vessel_id
        from bookings where id = ${id}`;
    if (!row) return { ok: false, error: 'That booking no longer exists.' };

    // A booking that has ended is what happened, and this product does not offer to
    // change what happened (domain/record). Refused here as well as in the panel,
    // because the panel's rules are hints and this action is a public endpoint —
    // the whole point of the rule is that a request cannot get around it.
    if (hasEnded(row.end_date as string, todayISO())) {
      return { ok: false, error: ENDED_REFUSAL };
    }

    /*
      `::text`, not String(a Date).

      postgres.js hands a `date` column back as a JS Date, and `String()` on one yields
      "Sat Nov 30 2019 19:00:00 GMT-0500 (Eastern Standard Time)". Compared with `>=`
      against "2026-09-22" that is a LEXICOGRAPHIC comparison, and a letter always beats
      a digit — so every booking read as "has not started yet", and every one of the
      2,031 imported rows became unmovable with the message that it cannot be moved into
      the past. The pure rule was right and tested; the value reaching it was not.

      The client runs the same `checkMove` on a real ISO string and therefore disagreed
      with the server — which this function's own comment claims cannot happen.
    */
    const verdict = checkMove({
      currentStart: row.start_date as string, start: to.start, end: to.end,
      today: todayISO(), ceiling: lastBookableISO(),
    });
    if (!verdict.ok) return { ok: false, error: verdict.error };

    const named = checkEdit({ kind: to.kind, label: to.label });
    if (!named.ok) return { ok: false, error: named.error };

    const link = vesselLinkFor(
      {
        kind: row.kind as BookingKind,
        label: row.label as string,
        vesselId: row.vessel_id as string | null,
      },
      { kind: to.kind, label: to.label },
    );

    await sql.begin(async (tx) => {
      // Inside the transaction, through the same function the create path uses, so a
      // renamed booking joins the hull it names — or registers it — and never ends up
      // pointing at the vessel it used to be. A hull left with no bookings drops off the
      // register on its own: it INNER JOINs bookings (invariant 2), and its row stays,
      // so the name still completes and a correction back finds it again.
      const vesselId =
        link.action === 'clear' ? null
          : link.action === 'resolve' ? await findOrCreateVessel(tx, link.name)
            : (row.vessel_id as string | null);

      await tx`
        update bookings
           set berth_id = ${to.berthId}, start_date = ${to.start}, end_date = ${to.end},
               label = ${to.label.trim()}, kind = ${to.kind}, notes = ${cleanNotes(to.notes)},
               vessel_id = ${vesselId}
         where id = ${id}`;
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
    /*
      Re-parsed here, not only in the input box.

      `createBooking` already does this, and says why: called directly with 987654 it
      stored 987654, and the queue reported a vessel "over by 987,599 feet". This is the
      OTHER path into the same column and it was not checking — so the same call against
      this action did the same thing, and `MAX_LENGTH_FT` was bypassed entirely, the
      column accepting anything an int4 holds. The component parses; the component is not
      the guard. The action is a public endpoint (invariant 1).

      `String()` because the argument is typed `number | null` and typing is not a
      runtime promise: 45.5, NaN and Infinity all arrive here as numbers, and all three
      are refused by name rather than by an int4 cast error nobody can read.
    */
    const parsed = parseLengthFt(lengthFt == null ? '' : String(lengthFt));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const length = parsed.value;

    /*
      One transaction, because `refreshTooLongItems` is resolve-then-reinsert: it closes
      every open too-long item in scope and then recreates the ones that still apply.
      Split across two statements on a pooled connection, a failure in between — a 15s
      statement timeout, an evicted connection, a killed function — left the items closed
      and never recreated. They would be gone from the queue and the badge with no error
      and no way back, which is invariant 3's "nothing vanishes silently" failing exactly
      where it is least visible.
    */
    await sql.begin(async (tx) => {
      await tx`
        update vessels
           set length_ft = ${length},
               length_source = ${length == null ? null : 'manual'}
         where id = ${vesselId}`;
      // Recording a length answers a question that was previously unanswerable, which
      // may reveal violations that were always there but could not be seen. The
      // missing-length count needs no update: it is derived, not stored.
      await refreshTooLongItems(tx, { vesselId });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}


/**
 * Resolve a whole group at once.
 *
 * The queue folds repeated rows — one vessel too long for one berth across four
 * bookings is one decision, so marking it done has to close all four. Resolving them
 * one at a time would leave the group half-present on the next render.
 */
/**
 * Mark review items done.
 *
 * The argument is an ARRAY from the client, which makes it the widest input the app
 * accepts, and it was taken on trust: unbounded, so a hundred thousand elements were
 * serialised into one bind and held a pooled connection until the statement timeout;
 * unvalidated, so a single non-uuid aborted the batch with Postgres' own parse error;
 * and read before the `try`, so a null argument threw out of the action instead of
 * returning a refusal.
 *
 * The cap is generous against real use — the largest group the 23-year import produced
 * is 36 — and small against the failure it prevents.
 */
const MAX_RESOLVE_BATCH = 500;

export async function resolveReviewItems(
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    if (!Array.isArray(ids)) return { ok: false, error: 'Nothing to mark done.' };
    // Filtered rather than refused: one malformed id in a batch should not throw away
    // the rest, and `where id = any(...)` already ignores an id that matches nothing.
    const clean = ids.filter((id) => isBookingId(id));
    if (clean.length === 0) return { ok: true };
    if (clean.length > MAX_RESOLVE_BATCH) {
      return { ok: false, error: `Too many at once. Mark up to ${MAX_RESOLVE_BATCH}.` };
    }

    await sql`
      update review_items set resolved_at = now()
       where id = any(${clean}::uuid[]) and resolved_at is null`;
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
 * ENGINEERING-LOG 28–30 have the history, including the Put back that deleted the live
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
  const err = e as { code?: string; constraint_name?: string; column_name?: string };
  if (err.code === '23P01') {
    return 'That berth is already occupied for part of those dates. The database refused the booking.';
  }
  if (err.code === '23514') {
    /*
      Four CHECK constraints reach this class and they are about different things, so the
      class alone cannot name the problem. Only `end_not_before_start` is about dates —
      and the default USED to claim all four were, which is the mistake this project has
      now made twice. The worst of them told someone editing a vessel's length on a page
      with no date field that "those dates are not valid".
    */
    if (err.constraint_name === 'vessel_required_for_vessel_kind') {
      return 'A vessel booking has to name a vessel. The database refused the change.';
    }
    if (err.constraint_name === 'vessels_length_ft_check') {
      return 'A length has to be a whole number of feet, above zero.';
    }
    if (err.constraint_name === 'bookings_kind_check') {
      return 'A booking is a vessel, an event or a closure, and that was none of them.';
    }
    return 'Those dates are not valid for a booking.';
  }
  if (err.code === '22000') {
    return 'The end date must not be before the start date.';
  }
  /*
    A berth id that names no berth. The trigger that copies `capacity_mode` finds no row,
    leaves `exclusive` null, and the NOT NULL rejects it — so the symptom is two steps
    from the cause, and the raw message named an internal column. `checkBooking` already
    answers "Unknown berth." for the same input; this is the write path saying the same
    thing instead of leaking the schema.
  */
  if (err.code === '23502' || err.code === '23503') {
    // Same trap as above, one class wider: the FK from a booking to a VESSEL lands here
    // too, and blaming the berth for it sends someone to check the one field that was
    // right. NOT NULL failures name their column, so a missing date says so.
    if (err.constraint_name === 'bookings_vessel_id_fkey') {
      return 'That vessel does not exist.';
    }
    if (err.column_name && err.column_name !== 'exclusive') {
      return 'That change is missing something it needs. Check every field and try again.';
    }
    return 'That berth does not exist.';
  }
  /*
    Never the raw message.

    postgres.js copies the server's text onto the error, so this returned Postgres
    verbatim for anything unmapped — `invalid input syntax for type uuid: "hello"` for a
    malformed id, and for a 3,000-character vessel name an index-row-size error naming
    `vessels_normalized_name_key`. A stranger can reach both by calling an action
    directly, and neither tells the user anything they can act on; the second hands out
    a piece of the schema. It is the same leak the `sel` guard was added to close, on a
    path nobody had looked at.

    The code is logged for whoever holds the credentials, and the user gets a sentence.
  */
  if (err.code) console.error('[db] unmapped SQLSTATE', err.code, err.constraint_name ?? '');
  return 'The database rejected that change. Nothing was saved.';
}
