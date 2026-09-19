/**
 * How long ago something happened, in words.
 *
 * Pure, like everything else in `src/lib` — no database, no React, no `Date.now()`
 * reached for internally. The caller passes `now`, which is what makes it testable
 * at a boundary instead of only near one.
 *
 * An exact timestamp is the wrong unit for a cancellation you might want to undo.
 * The question is "did I just do that, or was it last week", and `4 minutes ago`
 * answers it where `2026-09-19T21:58:03Z` does not.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-19T21:58:03Z` -> `19 Sep`. Read from the string, never through Date. */
function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * Past a week the relative form stops helping — "13 days ago" is harder to place than
 * a date — so it switches to the date itself.
 *
 * A future timestamp reads as `just now` rather than a negative age: clock skew
 * between the database and the server is real, small, and not worth a second concept.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const ms = now.getTime() - then;
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
  if (ms < 2 * DAY) return 'yesterday';
  if (ms < 7 * DAY) return plural(Math.floor(ms / DAY), 'day');
  return `on ${shortDate(iso)}`;
}
