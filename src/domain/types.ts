/**
 * Shared domain types.
 *
 * This module is PURE: nothing here imports a database driver, React, or Next.
 * See CLAUDE.md — `src/domain` must be unit-testable with no infrastructure.
 */

/**
 * An inclusive range of whole days, e.g. { start: '2010-07-13', end: '2010-07-16' }
 * covers Jul 13, 14, 15 AND 16.
 *
 * Dates are ISO `yyyy-mm-dd` strings, deliberately not `Date` objects: the source
 * data has no times and no timezone, and `Date` would invite an off-by-one from
 * UTC conversion. Lexicographic string comparison is correct for ISO dates.
 */
export type DayRange = {
  start: string;
  end: string;
};

/**
 * 'exclusive' — one booking at a time (every pier and float).
 * 'pooled'    — holds several boats at once ("Small craft slips"). Pooled berths
 *               are exempt from conflict detection; without this they would
 *               report a false conflict every time two institution boats are in.
 */
export type BerthCapacityMode = 'exclusive' | 'pooled';

export type Berth = {
  id: string;
  name: string;
  /** Usable length in feet. Null only if the source label had no length. */
  lengthFt: number | null;
  capacityMode: BerthCapacityMode;
};

export type Vessel = {
  id: string;
  canonicalName: string;
  /** Null for the ~95% of vessels whose length is recorded nowhere in the source. */
  lengthFt: number | null;
};

/**
 * What a booking actually is. All three occupy a berth.
 * Timing annotations ('ETA 1200') are NOT bookings and never become one.
 */
export type BookingKind = 'vessel' | 'event' | 'closure';

/**
 * 'active'              — normal. Subject to the database exclusion constraint.
 * 'conflict_unresolved' — an imported historical row that overlaps another. Loaded
 *                         rather than discarded, and deliberately outside the
 *                         constraint so real history survives. Nothing created
 *                         through the UI is ever given this status.
 * 'cancelled'           — withdrawn; frees the berth.
 */
export type BookingStatus = 'active' | 'conflict_unresolved' | 'cancelled';

export type Booking = {
  id: string;
  berthId: string;
  /** Null for events and closures, which have no vessel. */
  vesselId: string | null;
  kind: BookingKind;
  status: BookingStatus;
  /** Human label as it will be shown on the board. */
  label: string;
  range: DayRange;
};
