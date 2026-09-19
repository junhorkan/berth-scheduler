/** Month navigation helpers shared by the board chrome. */

/**
 * How far the schedule reaches either side of today, computed from the current date
 * so the window moves with the facility.
 *
 * Booking and viewing are deliberately different. You cannot book in the past — the
 * form's earliest date is today — but you must still be able to LOOK at what was
 * booked, or a booking made last month becomes unreachable the moment the year turns.
 * That is the same failure as a fixed upper bound, which once made future bookings
 * saveable but invisible; one year back keeps recent records reachable without an
 * endless year list.
 */
export const YEARS_BACK = 1;
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

/**
 * The earliest navigable year.
 *
 * Normally a year back — enough to review what was recently booked without an endless
 * year list. But it also stretches to cover whatever is actually ON the schedule:
 * loading the legacy workbook puts bookings in 1997, and a window that stopped at last
 * year would leave every one of them stored, searchable, and impossible to look at.
 *
 * That failure has happened twice in this project in the other direction, with a fixed
 * ceiling hiding future bookings. Deriving the bound from the data ends the whole class.
 */
export function firstYear(now?: Date, earliestBookingYear?: number | null): number {
  const idle = currentMonth(now).year - YEARS_BACK;
  return earliestBookingYear == null ? idle : Math.min(idle, earliestBookingYear);
}

/** The furthest year that can be navigated to or booked. */
export function lastYear(now?: Date): number {
  return currentMonth(now).year + YEARS_AHEAD;
}

/**
 * The earliest date a booking can be made for: today.
 *
 * A berth cannot be reserved for a day that has already passed, so the form refuses
 * it outright rather than accepting it and looking odd on the board.
 */
export function firstBookableISO(now?: Date): string {
  return todayISO(now);
}

export function lastBookableISO(now?: Date): string {
  return `${lastYear(now)}-12-31`;
}

export function clampMonth(
  year: number, month: number, now?: Date, earliestBookingYear?: number | null,
): { year: number; month: number } {
  const fallback = currentMonth(now);
  let y = Number.isFinite(year) ? Math.trunc(year) : fallback.year;
  let m = Number.isFinite(month) ? Math.trunc(month) : fallback.month;
  if (!Number.isFinite(year) && !Number.isFinite(month)) return fallback;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  const min = firstYear(now, earliestBookingYear);
  if (y < min) return { year: min, month: 1 };
  const max = lastYear(now);
  if (y > max) return { year: max, month: 12 };
  return { year: y, month: m };
}

export function step(
  year: number, month: number, delta: number, now?: Date, earliestBookingYear?: number | null,
) {
  return clampMonth(year, month + delta, now, earliestBookingYear);
}

export function monthHref(year: number, month: number): string {
  return `/?y=${year}&m=${month}`;
}

/** Whether a given month is the one the facility is in right now. */
export function isCurrentMonth(year: number, month: number, now?: Date): boolean {
  const c = currentMonth(now);
  return c.year === year && c.month === month;
}
