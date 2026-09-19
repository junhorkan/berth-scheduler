/** Month navigation helpers shared by the board chrome. */

export const FIRST_YEAR = 1997;
/** 1997 is a partial year in the source: its schedule starts in August. */
export const FIRST_MONTH = 8;
export const LAST_YEAR = 2019;
export const LAST_MONTH = 12;

/**
 * The board opens on July 2010 rather than today's date.
 *
 * Today is outside the imported range, so a date-based default would greet everyone
 * with an empty grid. July 2010 is the densest month that contains all four bar states
 * at once — a confirmed fit, a vessel too long for its berth, a non-vessel event, and
 * plenty of unrecorded lengths — so the board explains itself on arrival.
 */
export const DEFAULT_YEAR = 2010;
export const DEFAULT_MONTH = 7;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function clampMonth(year: number, month: number): { year: number; month: number } {
  let y = Number.isFinite(year) ? Math.trunc(year) : DEFAULT_YEAR;
  let m = Number.isFinite(month) ? Math.trunc(month) : DEFAULT_MONTH;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  // The data begins in AUGUST 1997, not January, so the lower bound is a month bound
  // and not just a year bound.
  if (y < FIRST_YEAR || (y === FIRST_YEAR && m < FIRST_MONTH)) {
    return { year: FIRST_YEAR, month: FIRST_MONTH };
  }
  if (y > LAST_YEAR || (y === LAST_YEAR && m > LAST_MONTH)) {
    return { year: LAST_YEAR, month: LAST_MONTH };
  }
  return { year: y, month: m };
}

export function step(year: number, month: number, delta: number) {
  return clampMonth(year, month + delta);
}

export function monthHref(year: number, month: number): string {
  return `/?y=${year}&m=${month}`;
}
