/** Month navigation helpers shared by the board chrome. */

export const FIRST_YEAR = 1997;
/** 1997 is a partial year in the source: its schedule starts in August. */
export const FIRST_MONTH = 8;

/**
 * How far ahead the schedule can be booked.
 *
 * The imported sample ends in December 2019, but that is a fact about the sample, NOT
 * a limit on the facility. A berth booked for next season must be reachable, so the
 * upper bound is computed from today rather than pinned to the data. Three years is
 * generous for a research schedule without making the year list absurd.
 */
export const YEARS_AHEAD = 3;

/**
 * "Today" means today at the facility, which is in Woods Hole, Massachusetts.
 *
 * The server runs in UTC, so asking it for the local date would roll the board over to
 * the next month at 8pm on the last day of a month — the coordinator would arrive to a
 * board a month ahead of the one on their wall.
 */
export const FACILITY_TIME_ZONE = 'America/New_York';

/** The extent of the imported sample, for pointing people at data that exists. */
export const SAMPLE_LAST_YEAR = 2019;
/**
 * The densest month in the sample: 27 bookings, and the only one containing all four
 * bar states at once. Used for the "see the imported schedule" jump, not as a default.
 */
export const BUSIEST_MONTH = { year: 2010, month: 7 };

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Today's date at the facility, as `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FACILITY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** The month the board opens on: the one the facility is actually in. */
export function currentMonth(now?: Date): { year: number; month: number } {
  const iso = todayISO(now);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/** The furthest year that can be navigated to or booked. */
export function lastYear(now?: Date): number {
  return currentMonth(now).year + YEARS_AHEAD;
}

/** The furthest date that can be booked, for the date inputs' `max`. */
export function lastBookableISO(now?: Date): string {
  return `${lastYear(now)}-12-31`;
}

export function clampMonth(
  year: number, month: number, now?: Date,
): { year: number; month: number } {
  const fallback = currentMonth(now);
  let y = Number.isFinite(year) ? Math.trunc(year) : fallback.year;
  let m = Number.isFinite(month) ? Math.trunc(month) : fallback.month;
  if (!Number.isFinite(year) && !Number.isFinite(month)) return fallback;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  // The data begins in AUGUST 1997, not January, so the lower bound is a month bound
  // and not just a year bound.
  if (y < FIRST_YEAR || (y === FIRST_YEAR && m < FIRST_MONTH)) {
    return { year: FIRST_YEAR, month: FIRST_MONTH };
  }
  const max = lastYear(now);
  if (y > max) return { year: max, month: 12 };
  return { year: y, month: m };
}

export function step(year: number, month: number, delta: number, now?: Date) {
  return clampMonth(year, month + delta, now);
}

export function monthHref(year: number, month: number): string {
  return `/?y=${year}&m=${month}`;
}

/** Whether a given month is the one the facility is in right now. */
export function isCurrentMonth(year: number, month: number, now?: Date): boolean {
  const c = currentMonth(now);
  return c.year === year && c.month === month;
}
