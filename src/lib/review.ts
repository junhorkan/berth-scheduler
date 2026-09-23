/**
 * Collapsing the attention queue.
 *
 * The queue showed one row per affected booking, so `M/V Iron Heron` appeared four
 * times in a row, each saying "Vessel is 100ft but the berth is 55ft". That is one
 * vessel with one problem across four bookings — 28 rows for 15 real problems, and
 * the repetition buried the items that differ.
 *
 * Pure: no database, no React.
 */
import { formatSpanFull } from './search';

/** The fields of a review row this module needs. Structural, so `db` stays out of `lib`. */
export type Groupable = {
  id: string;
  type: string;
  rawText: string | null;
  detail: string | null;
  vesselId: string | null;
  berthName: string | null;
  bookingStart: string | null;
  importSheet: string | null;
  importRow: number | null;
  importCol: number | null;
};

export type ReviewGroup<T extends Groupable> = {
  key: string;
  type: string;
  /** Every row folded in, earliest first. `rows[0]` supplies the headline. */
  rows: T[];
  /** Ids to resolve together when the group is marked done. */
  ids: string[];
};

/**
 * What makes two rows "the same problem".
 *
 * A vessel too long for a berth is identified by that pairing — the same hull can be
 * fine in one berth and not another, so the berth is part of the key. An unreadable
 * cell is identified by its text; the same phrase appearing in four different months
 * is one classification decision, taken once.
 *
 * A conflict is never grouped. Each one is a distinct pair of bookings needing its
 * own resolution.
 */
function keyFor(row: Groupable): string {
  if (row.type === 'too_long') return `too_long|${row.vesselId ?? row.rawText}|${row.berthName ?? ''}`;
  if (row.type === 'unclassified') return `unclassified|${(row.rawText ?? '').trim().toUpperCase()}`;
  return `${row.type}|${row.id}`;
}

export function groupReviewItems<T extends Groupable>(rows: T[]): ReviewGroup<T>[] {
  const byKey = new Map<string, ReviewGroup<T>>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.ids.push(row.id);
    } else {
      byKey.set(key, { key, type: row.type, rows: [row], ids: [row.id] });
    }
  }
  for (const group of byKey.values()) {
    group.rows.sort((a, b) => (a.bookingStart ?? '').localeCompare(b.bookingStart ?? ''));
    group.ids = group.rows.map((r) => r.id);
  }
  return [...byKey.values()];
}

/**
 * Where a group of occurrences happened, for the line under the headline.
 *
 * A row carries its booking's start and no end, so a single occurrence is one date —
 * `Jul 11 2017` — and never a span it cannot know the far side of. Several occurrences
 * are first start to last start, which is a range of bookings rather than one stay, so
 * the count leads and the dates follow it.
 */
export function describeOccurrences(group: ReviewGroup<Groupable>): string | null {
  const dated = group.rows.map((r) => r.bookingStart).filter((d): d is string => Boolean(d));
  if (dated.length === 0) return null;
  if (dated.length === 1) return formatSpanFull(dated[0], dated[0]);
  return `${dated.length} bookings, ${formatSpanFull(dated[0], dated[dated.length - 1])}`;
}

/**
 * Display-only repairs to a sentence the importer stored. The text in the database is
 * left exactly as it was written; nothing here rewrites anybody's data.
 *
 * Three of them, all of them prose the app has since outgrown:
 *
 * It ends with the span in brackets — `... over by 45ft. (2006-02-04..2006-02-04)` —
 * which the meta line underneath already states.
 *
 * A conflict *begins* with one — `2017-07-11..2017-07-11 on South Float East overlaps
 * OSV AMBER REEF` — and an unreadable cell carries a year-month and a day number,
 * `In North Pier West, 2001-06 day 16`. Both are the only ISO dates left in the
 * product; they become the span and the date the rest of the site would write. The
 * berth stays: the meta line repeats it, but dropping words out of the middle of a
 * stored sentence is a bigger claim than restating its dates.
 *
 * And it spells feet with an apostrophe, because that is what the importer wrote when
 * these rows were created. The app says `ft` everywhere now, and `refreshTooLongItems`
 * writes `ft` — but only for rows it rebuilds, so the sentence a visitor actually reads
 * on the live schedule is still `Vessel is 100' but the berth is 55'`. Normalising here
 * fixes old rows and new ones together.
 */
export function tighten(detail: string, type?: string): string {
  return detail
    // ...except on a conflict, where that trailing span belongs to the OTHER booking.
    // The meta line below states THIS booking's dates, so stripping it left
    // "overlaps OSV AMBER REEF" with no way to learn when the vessel it clashes with
    // is there — on the one genuine double-booking in 23 years, the row this queue
    // exists for.
    .replace(type === 'conflict' ? /(?!)/ : /\s*\(\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}\)\s*$/, '')
    .replace(
      /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})(?=\s|$)/,
      (_all, start: string, end: string) => formatSpanFull(start, end),
    )
    // `2001-06 day 16` is a year-month and a day number, never a span: the importer
    // knows which cell it read and not how long the stay was.
    .replace(
      /\b(\d{4})-(\d{2}) day (\d{1,2})\b/,
      (_all, year: string, month: string, day: string) => {
        const iso = `${year}-${month}-${day.padStart(2, '0')}`;
        return formatSpanFull(iso, iso);
      },
    )
    // Only after a number, so an apostrophe in a vessel's name is left alone.
    .replace(/(\d)'/g, '$1ft');
}
