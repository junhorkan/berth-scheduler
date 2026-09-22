/**
 * Double-booking detection.
 *
 * This is the HARD rule. The database enforces it with an exclusion constraint so
 * an overlap is literally unstorable; this module exists so the UI can tell the
 * user *before* they submit, and so the rule is unit-testable without a database.
 *
 * The two must agree. See db/migrations for the SQL:
 *   EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active' AND exclusive)
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

/** True when the candidate can be saved as 'active'. */
export function isBookable(
  candidate: Pick<Booking, 'berthId' | 'range'> & Partial<Pick<Booking, 'id'>>,
  existing: readonly Booking[],
  berth: Pick<Berth, 'id' | 'capacityMode'>,
): boolean {
  return isValidRange(candidate.range) && findConflicts(candidate, existing, berth).length === 0;
}
