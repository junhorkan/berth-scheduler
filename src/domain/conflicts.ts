/**
 * Double-booking detection.
 *
 * This is the HARD rule. The database enforces it with an exclusion constraint so
 * an overlap is literally unstorable; this module exists so the UI can tell the
 * user *before* they submit, and so the rule is unit-testable without a database.
 *
 * The two must agree. See db/migrations for the SQL:
 *   EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active' AND exclusive)
 *
 * `findVesselClashes` at the foot of the file is the one soft rule kept in this module
 * rather than in fit.ts, because it is about overlapping days and reads off the same
 * `overlaps`. It has no constraint behind it, on purpose; its own comment says why.
 */

import type { Booking, DayRange, Berth } from './types';

/**
 * Do two inclusive day ranges share at least one day?
 *
 * Inclusive-end semantics matter here. A vessel booked Mon–Wed and another booked
 * Wed–Fri BOTH need the berth on Wednesday, so that is a conflict. Mon–Tue and
 * Wed–Thu are not. Treating same-day turnover as a conflict is the safe default
 * and is recorded in ASSUMPTIONS.md rather than left implicit.
 */
export function overlaps(a: DayRange, b: DayRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * The days two ranges both cover, or null when they never meet.
 *
 * Lexicographic min/max is correct for ISO dates, for the reason DayRange is a string
 * in the first place: no Date, so no UTC to shift the answer by a day.
 */
export function sharedRange(a: DayRange, b: DayRange): DayRange | null {
  if (!overlaps(a, b)) return null;
  return {
    start: a.start > b.start ? a.start : b.start,
    end: a.end < b.end ? a.end : b.end,
  };
}

/** Inclusive day count of a range. Jul 13–16 is 4 days, not 3. */
export function rangeLengthDays(range: DayRange): number {
  const ms = Date.parse(range.end + 'T00:00:00Z') - Date.parse(range.start + 'T00:00:00Z');
  return Math.round(ms / 86_400_000) + 1;
}

/** A range is only valid if it does not end before it starts. */
export function isValidRange(range: DayRange): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(range.start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.end) &&
    range.start <= range.end
  );
}

/**
 * Which existing bookings would the candidate collide with?
 *
 * A booking only conflicts when ALL of these hold:
 *   - same berth
 *   - that berth is 'exclusive' (pooled slips hold several boats, so never conflict)
 *   - the other booking is 'active' (cancelled frees the berth; an imported
 *     'conflict_unresolved' row is already flagged and must not cascade)
 *   - the day ranges overlap
 *   - it is not the candidate itself (so editing a booking does not fight itself)
 *
 * Returns every collision, not just the first — the UI names them all.
 */
export function findConflicts(
  candidate: Pick<Booking, 'berthId' | 'range'> & Partial<Pick<Booking, 'id'>>,
  existing: readonly Booking[],
  berth: Pick<Berth, 'id' | 'capacityMode'>,
): Booking[] {
  if (berth.capacityMode === 'pooled') return [];

  return existing.filter(
    (other) =>
      other.id !== candidate.id &&
      other.berthId === candidate.berthId &&
      other.status === 'active' &&
      overlaps(candidate.range, other.range),
  );
}

/** The same hull found on another berth over some of the same days. */
export type VesselClash = {
  booking: Booking;
  /** The days both bookings cover. */
  shared: DayRange;
  /** Length of `shared`. One day is plausibly a berth shift that morning; two is not. */
  sharedDays: number;
};

/**
 * Where else is this hull booked while it is here?
 *
 * ADVISORY — amber, never blocking — and this is the awkward case for the split the
 * whole design rests on (DECISIONS 2). Unlike fit, this IS decidable: the dates are
 * always known, so the instinct is a second EXCLUDE on (vessel_id, during). The source
 * schedule forbids it. Twelve of its rows already put one hull at two berths on the
 * same day — four of them over two whole days, eight sharing exactly one, which is what
 * a same-day berth shift looks like in a workbook that records only whole days. A
 * constraint would abort `npm run import` on those rows and roll back all 2,031, so the
 * history the project promises to keep could not be loaded at all. Decidable, but
 * already present: therefore it warns.
 *
 * Same berth is deliberately NOT reported here. That is the hard conflict — red,
 * refused by the exclusion constraint — and saying it twice in two colours would blur
 * the one distinction the UI exists to make.
 *
 * A pooled berth is not exempt, although findConflicts exempts it: the question is how
 * many places one hull is in, not how many hulls a berth holds.
 *
 * Events and closures carry no vessel, so they fall out on identity alone.
 */
export function findVesselClashes(
  candidate: Pick<Booking, 'berthId' | 'vesselId' | 'range'> & Partial<Pick<Booking, 'id'>>,
  existing: readonly Booking[],
): VesselClash[] {
  if (!candidate.vesselId) return [];

  const clashes: VesselClash[] = [];
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (other.vesselId !== candidate.vesselId) continue;
    if (other.berthId === candidate.berthId) continue;
    if (other.status !== 'active') continue;
    const shared = sharedRange(candidate.range, other.range);
    if (!shared) continue;
    clashes.push({ booking: other, shared, sharedDays: rangeLengthDays(shared) });
  }
  return clashes;
}

/** True when the candidate can be saved as 'active'. */
export function isBookable(
  candidate: Pick<Booking, 'berthId' | 'range'> & Partial<Pick<Booking, 'id'>>,
  existing: readonly Booking[],
  berth: Pick<Berth, 'id' | 'capacityMode'>,
): boolean {
  return isValidRange(candidate.range) && findConflicts(candidate, existing, berth).length === 0;
}
