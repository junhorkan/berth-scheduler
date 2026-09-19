/**
 * Turns raw spreadsheet cells into the bookings a human would actually read off the grid.
 *
 * Two defects in the source make this necessary, and converting to absolute dates first
 * lets one merge pass fix both:
 *
 *   1. DAY-BY-DAY ENTRY. Some stays were typed one cell per day instead of as a merged
 *      range, so 'R/V Long Ketch' appears in four consecutive cells rather than once.
 *   2. MONTH-CROSSING STAYS. A stay from Jul 28 to Aug 3 is physically two cells in two
 *      different month blocks. Left unmerged it reads as two separate visits.
 *
 * Once every cell carries a real ISO date, both become the same problem: adjacent or
 * overlapping ranges for the same vessel on the same berth are one stay.
 *
 * ASSUMPTION (recorded in ASSUMPTIONS.md): contiguous same-name cells on one berth are a
 * single continuous stay. A vessel that genuinely departed and returned the next day is
 * indistinguishable from one that stayed, and the grid reads it as one bar, so we match
 * the grid.
 */

import type { RawEntry } from './parseWorkbook';
import { canonicalVesselName } from '../domain/normalize';
import type { BookingKind } from '../domain/types';

export type Provenance = { sheet: string; row: number; col: number };

export type StitchedBooking = {
  berthName: string;
  berthLengthFt: number | null;
  kind: BookingKind;
  /** Display text, e.g. 'R/V Long Ketch' or 'Community sail day'. */
  label: string;
  /** Join key for vessels; null for events and closures. */
  normalizedVesselName: string | null;
  /** Inclusive ISO dates. */
  start: string;
  end: string;
  /** Every source cell that contributed, so any row can be traced back. */
  provenance: Provenance[];
};

export type StitchStats = {
  occupancyCells: number;
  bookings: number;
  /** Cells absorbed into an earlier booking by merging. */
  cellsMerged: number;
  /** Merges that spanned a month boundary. */
  monthCrossingMerges: number;
  annotationsDropped: number;
  unclassifiedCount: number;
};

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day after an ISO date, as ISO. Used to test adjacency. */
function nextDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function stitch(entries: readonly RawEntry[]): {
  bookings: StitchedBooking[];
  annotations: RawEntry[];
  unclassified: RawEntry[];
  stats: StitchStats;
} {
  const annotations = entries.filter((e) => e.kind === 'annotation');
  const unclassified = entries.filter((e) => e.kind === 'unclassified');
  const occupancy = entries.filter(
    (e) => e.kind === 'vessel' || e.kind === 'event' || e.kind === 'closure',
  );

  // Group by berth + identity, so only the same thing on the same berth can merge.
  const groups = new Map<string, StitchedBooking[]>();

  for (const e of occupancy) {
    const kind = e.kind as BookingKind;
    const canon = kind === 'vessel' ? canonicalVesselName(e.text) : null;
    const label = canon ? canon.display : e.text.replace(/\s+/g, ' ');
    const normalizedVesselName = canon ? canon.normalized : null;
    const identity = normalizedVesselName ?? `${kind}:${label.toUpperCase()}`;
    const key = `${e.berthName}|${identity}`;

    const item: StitchedBooking = {
      berthName: e.berthName,
      berthLengthFt: e.berthLengthFt,
      kind,
      label,
      normalizedVesselName,
      start: iso(e.year, e.month, e.startDay),
      end: iso(e.year, e.month, e.endDay),
      provenance: [{ sheet: e.sheet, row: e.row, col: e.col }],
    };

    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const bookings: StitchedBooking[] = [];
  let cellsMerged = 0;
  let monthCrossingMerges = 0;

  for (const list of groups.values()) {
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    let current = list[0];
    for (let i = 1; i < list.length; i++) {
      const next = list[i];
      // Adjacent (next starts the day after current ends) or overlapping.
      if (next.start <= nextDay(current.end)) {
        const crossedMonth = next.start.slice(0, 7) !== current.end.slice(0, 7);
        if (next.end > current.end) current.end = next.end;
        current.provenance.push(...next.provenance);
        cellsMerged++;
        if (crossedMonth) monthCrossingMerges++;
      } else {
        bookings.push(current);
        current = next;
      }
    }
    bookings.push(current);
  }

  bookings.sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : a.berthName.localeCompare(b.berthName),
  );

  return {
    bookings,
    annotations,
    unclassified,
    stats: {
      occupancyCells: occupancy.length,
      bookings: bookings.length,
      cellsMerged,
      monthCrossingMerges,
      annotationsDropped: annotations.length,
      unclassifiedCount: unclassified.length,
    },
  };
}
