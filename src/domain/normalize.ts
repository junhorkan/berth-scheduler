/**
 * Turning 23 years of free-text spreadsheet cells into structured records.
 *
 * Every pattern here was derived from the actual sample workbook, not guessed.
 * Counts in comments are real occurrence counts from that file.
 */

/** What a single spreadsheet cell turned out to be. */
export type EntryKind =
  | 'vessel'
  | 'event'
  | 'closure'
  /** Timing/status note attached to a neighbouring booking. Occupies NO berth. */
  | 'annotation'
  /**
   * Could not be confidently classified. Deliberately NOT silently dropped —
   * these become Review items for a human to resolve. See CLAUDE.md.
   */
  | 'unclassified';

/**
 * Vessel type prefixes seen in the source.
 * `OS/V` is a typo-variant of `OSV` and is folded together (see canonicalVesselName).
 * `Barge` is included because barges are booked exactly like vessels here.
 */
const VESSEL_PREFIX = /^(R\/V|M\/V|S\/V|M\/Y|S\/Y|OSV|OS\/V|F\/V|Tug|Barge)\s+\S/i;

/**
 * Pure timing or status notes. These sit in a cell next to a booking and must never
 * become bookings themselves: e.g. 'ETA 1200', 'Departs 0600', 'ETD PM', bare '1400'.
 *
 * Note this must NOT swallow operational events that happen to carry a time, such as
 * 'Bunkering 1000' or 'Fueling @0800' — those genuinely occupy the berth, so the
 * patterns below are anchored and narrow.
 */
const ANNOTATION = [
  /^ET[AD]\b/i,
  /^arriv(al|es|ing)?\b/i,
  /^departs?\b/i,
  /^departure\b/i,
  /^delayed\b/i,
  /^\d{3,4}$/,
  /^(AM|PM)$/i,
];

/**
 * Work that takes a berth OUT of service. Checked before events, because several
 * closure labels also contain event-ish words ('Road race - access limited').
 */
const CLOSURE = /maintenance|repair|rebuild|no docking|no usage|restricted|access limited|bollard|paving|dredg|utility work|closed|out of service/i;

/**
 * Non-vessel activities that still occupy a berth — the case the brief calls out
 * explicitly ("community sail days that also occupy a berth").
 */
const EVENT = /sail day|open house|tour\b|stroll|reception|campus event|film crew|drill|training|regatta|ceremony|bunker|fuel|provision|load equipment|emergency port call|holiday|festival|visit\b/i;

/**
 * Classify one raw cell value.
 *
 * Order is significant: vessel prefixes are unambiguous so they win; then pure
 * annotations; then closures (which outrank events by keyword overlap); then events.
 * Anything left is 'unclassified' and becomes a human review item rather than a guess.
 */
export function classifyEntry(raw: string): EntryKind {
  const text = raw.trim();
  if (text === '') return 'unclassified';

  if (VESSEL_PREFIX.test(text)) return 'vessel';
  if (ANNOTATION.some((re) => re.test(text))) return 'annotation';
  if (CLOSURE.test(text)) return 'closure';
  if (EVENT.test(text)) return 'event';
  return 'unclassified';
}

/**
 * Collapse spelling variants of one vessel into a single identity.
 *
 * The source writes the same hull two ways — 'Barge SALT DORY' (41 rows) and
 * 'Barge Salt Dory' (33 rows) are one barge; 'S/V FAR HORIZON' / 'S/V Far Horizon'
 * likewise. Case-folding alone collapses 446 distinct spellings to 418 vessels.
 *
 * Returns both forms: `normalized` is the join key, `display` is what to show.
 * We keep the first-seen display casing rather than title-casing, so we never
 * invent a spelling the facility does not use.
 */
/**
 * Text as a reader sees it: one Unicode spelling, and nothing that takes no space.
 *
 * Two separate problems, both of which quietly make one boat into two hulls.
 *
 * **Composition.** `Å` can be one code point or `A` plus a combining ring. They render
 * identically and compare unequal, so `R/V Åland` pasted from a Mac and the same name
 * typed here produce two register rows, two fit answers, and a search for one that
 * cannot find the other. `NFC` settles on a single spelling. Decomposed text arrives
 * routinely from macOS copy and paste, so this is not a theoretical input.
 *
 * **Invisible characters.** `String.trim()` removes `\u00A0` and `\uFEFF` and nothing
 * else, and `\s` matches none of the zero-width family — so a label of one zero-width
 * space passed every gate in the app and drew a blank bar on the board and a blank row
 * on the register, and `R/V Tern` with one appended registered a second hull for a boat
 * that already had one.
 *
 * `\p{Cf}` is the format category, which covers all of them. It also covers the zero-
 * width joiners that matter in Devanagari, Persian and emoji sequences — a real cost,
 * accepted because a berth register holds vessel names and the alternative is a hull
 * you cannot see, cannot search for, and cannot merge.
 */
export function visibleText(raw: string): string {
  return raw.normalize('NFC').replace(/\p{Cf}/gu, '');
}

export function canonicalVesselName(raw: string): { display: string; normalized: string } {
  const display = visibleText(raw)
    .trim()
    .replace(/\s+/g, ' ')
    // Fold the OS/V typo into OSV so the two spellings become one vessel.
    .replace(/^OS\/V\b/i, 'OSV');
  return { display, normalized: display.toUpperCase() };
}

/**
 * Some registry entries carry the length inside the name: "R/V High Drift 120'".
 * Returns the feet value, or null when the name has no trailing length.
 */
export function extractLengthFromVesselName(raw: string): number | null {
  const m = raw.trim().match(/\s(\d{2,3})'$/);
  return m ? Number(m[1]) : null;
}

/** Strip a trailing length off a registry name: "R/V High Drift 120'" -> "R/V High Drift". */
export function stripLengthFromVesselName(raw: string): string {
  return raw.trim().replace(/\s\d{2,3}'$/, '');
}

/**
 * Berth row labels embed the usable length: "North Pier West - 410'".
 *
 * `North Finger Piers:` is a SECTION HEADER, not a berth — it takes no bookings and
 * has no length. Returning null for it keeps a phantom berth out of the schema.
 */
export function parseBerthLabel(raw: string): { name: string; lengthFt: number | null } | null {
  const text = raw.trim();
  if (text === '' || text.endsWith(':')) return null;

  // Read from the end rather than with `^(.*?)\s*-\s*(\d{2,4})'$`: that lazy prefix
  // retried the trailing whitespace at every position, which is quadratic — half a
  // second on one long label. Same result, one pass: the length is the digits before the
  // closing quote, and the name is what precedes the dash in front of them.
  const length = /(\d{2,4})'$/.exec(text);
  if (length) {
    const before = text.slice(0, length.index).trimEnd();
    if (before.endsWith('-')) {
      return { name: before.slice(0, -1).trim(), lengthFt: Number(length[1]) };
    }
  }
  // e.g. "Small craft slips (institution boats)" — a real berth with no stated length.
  return { name: text, lengthFt: null };
}

/**
 * "Small craft slips" holds several institution boats simultaneously, so it must be
 * exempt from conflict detection or it reports a false conflict constantly.
 */
export function capacityModeFor(berthName: string): 'exclusive' | 'pooled' {
  return /small craft slips/i.test(berthName) ? 'pooled' : 'exclusive';
}
