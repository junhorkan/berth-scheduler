/**
 * Collapsing the attention queue.
 *
 * The queue showed one row per affected booking, so `M/V Iron Heron` appeared four
 * times in a row, each saying "Vessel is 100' but the berth is 55'". That is one
 * vessel with one problem across four bookings — 28 rows for 15 real problems, and
 * the repetition buried the items that differ.
 *
 * Pure: no database, no React.
 */

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

/** Where a group of occurrences happened, for the line under the headline. */
export function describeOccurrences(group: ReviewGroup<Groupable>): string | null {
  const dated = group.rows.map((r) => r.bookingStart).filter((d): d is string => Boolean(d));
  if (dated.length === 0) return null;
  if (dated.length === 1) return dated[0];
  return `${dated.length} bookings, ${dated[0]} to ${dated[dated.length - 1]}`;
}
