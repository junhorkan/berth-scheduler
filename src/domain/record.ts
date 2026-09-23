/**
 * When a booking stops being a plan and becomes a record.
 *
 * The schedule holds two kinds of thing that look identical on the board. A booking that
 * has not finished is **work**: it can be moved, renamed, given a different berth, or
 * called off, because it describes something that has not happened yet or is happening
 * now. A booking that has ended is **what happened** — and this product does not offer
 * to change what happened.
 *
 * That is a narrower claim than it sounds, and it is worth stating why it is the right
 * one *here* rather than a universal truth. Real facilities do correct their logs: the
 * wrong hull gets written in a box, and somebody fixes it next Tuesday. An earlier
 * version of this system allowed exactly that, and `move.ts` still carries the reasoning
 * — a typed-wrong date from 2010 should be fixable, not merely cancellable.
 *
 * What changed is not the principle but the deployment. This runs on a public URL with
 * no accounts, by deliberate choice (DECISIONS 11), and an edit overwrites berth, span,
 * name, kind and note in place with no snapshot — the one irreversible action in the
 * product. Put those two together and "anyone may correct the record" reads as "anyone
 * may rewrite 23 years of somebody else's history, permanently, from a link". A
 * correction and an act of vandalism are the same HTTP request when nobody is signed in.
 *
 * So the correction stays available to whoever holds the database credentials, and comes
 * off the public page — the same line already drawn around importing (invariant 12).
 *
 * This also settles a disagreement the app was having with itself. Review already sorts
 * its queue by whether anything can still be done, and files every 2001–2017 problem
 * under History because "nobody can move a vessel that sailed nine years ago". The
 * booking panel, opened on one of those same rows, offered to move it. Now both halves
 * say the same thing.
 *
 * Pure, so the panel can explain and the write path can refuse in one sentence
 * (invariant 1). The panel's rules are hints; the action behind it is a public endpoint,
 * and this rule is worth nothing if it only lives in a disabled button.
 */

/**
 * Has this booking finished?
 *
 * Both dates are ISO `YYYY-MM-DD`, which compare correctly as strings, and `today` is the
 * facility's own date from `lib/nav` — never the server's UTC, which after 8pm Eastern is
 * already tomorrow and would close a booking a day early.
 *
 * The end date is inclusive: a booking ending today is still running today, so it is not
 * a record until tomorrow. That is the same boundary the board draws with.
 */
export function hasEnded(endDate: string, today: string): boolean {
  return endDate < today;
}

/**
 * Why the booking cannot be changed, in the one place both ends read it from.
 *
 * It says what is true of the booking rather than what the reader did wrong, and it names
 * the rule — "part of the record" — so the refusal teaches it instead of just denying.
 */
export const ENDED_REFUSAL =
  'This booking has ended, so it is part of the record and cannot be changed.';
