/** Month navigation helpers shared by the board chrome. */

/**
 * How far the schedule reaches either side of today.
 *
 * Both bounds are computed from the current date rather than fixed, so the window
 * moves with the facility. Far enough back to record a season that has already
 * happened, far enough forward to plan the next ones, without an absurd year list.
 */
export const YEARS_BACK = 3;
export const YEARS_AHEAD = 3;

/**
 * "Today" means today at the facility, which is in Woods Hole, Massachusetts.
 *
 * The server runs in UTC, so asking it for the local date would roll the board over to
 * the next month at 8pm on the last day of a month — the coordinator would arrive to a
 * board a month ahead of the one on their wall.
 */
export const FACILITY_TIME_ZONE = 'America/New_York';

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

/** The earliest year that can be navigated to or booked. */
export function firstYear(now?: Date): number {
  return currentMonth(now).year - YEARS_BACK;
}

/** The furthest year that can be navigated to or booked. */
export function lastYear(now?: Date): number {
  return currentMonth(now).year + YEARS_AHEAD;
}

/** The bookable window, for the date inputs' `min` and `max`. */
export function firstBookableISO(now?: Date): string {
  return `${firstYear(now)}-01-01`;
}
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
  const min = firstYear(now);
  if (y < min) return { year: min, month: 1 };
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
