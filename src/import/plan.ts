/**
 * Workbook bytes in, an import plan out: everything the schedule would contain, and a
 * reconciliation of how the file became it. Writes nothing.
 *
 * This is the one place the legacy workbook is interpreted. The command-line importer
 * writes a plan to the database; `npm run import:check` prints one; the in-browser
 * check at /check renders one. They cannot disagree, because there is only this.
 *
 * It used to live inline in `scripts/import.mts`, as top-level script code with no
 * tests: the conflict pre-classification, the review items, the fit checks. Here it is a
 * pure function, and the counts it produces from the real workbook are locked in
 * `plan.test.ts`.
 *
 * No `node:fs`: it takes bytes, so it bundles for a browser.
 */
import type * as XLSX from 'xlsx';
import { readWorkbook } from './workbook';
import { parseGrids } from './parseWorkbook';
import type { ParseReport } from './parseWorkbook';
import { parseRegistryBook } from './parseRegistry';
import type { RegistryVessel } from './parseRegistry';
import { stitch } from './stitch';
import type { StitchedBooking, StitchStats } from './stitch';
import { capacityModeFor } from '../domain/normalize';
import { overlaps } from '../domain/conflicts';
import { checkFit } from '../domain/fit';
import { ImportError } from './errors';

export { ImportError };

export type PlannedBooking = StitchedBooking & {
  status: 'active' | 'conflict_unresolved';
  /** For a conflict: the booking it overlaps, as "label (start..end)". */
  conflictWith: string | null;
};

export type PlannedVessel = {
  display: string;
  normalized: string;
  lengthFt: number | null;
  loaFt: number | null;
  lengthSource: 'registry_name' | null;
  operator: string | null;
};

export type PlannedReviewItem = {
  type: 'conflict' | 'too_long' | 'unclassified';
  /** Index into `plan.bookings`; ids do not exist until something writes the plan. */
  bookingIndex: number | null;
  berthName: string | null;
  vesselNormalized: string | null;
  rawText: string;
  detail: string;
  importYear: number | null;
  importSheet: string | null;
  importRow: number | null;
  importCol: number | null;
};

/** A cell's position, as a person reads it in the spreadsheet. */
export type Cell = { sheet: string; row: number; col: number };

/** What the file turned out to hold — the part a person reads. */
export type Reconciliation = {
  sheets: {
    yearGrids: string[];
    registry: string[];
    /** Sheets read as neither, with the reason. */
    notRead: { sheet: string; reason: string }[];
  };
  months: { resolved: number; unaligned: string[]; calendarUnverified: string[] };
  /** Source defects the parser found and handled. */
  defects: {
    carriedOverDecembers: { sheet: string; month: number; year: number }[];
    implausibleYears: { sheet: string; row: number; month: number; statedYear: number; usedYear: number }[];
    orphanedCells: (Cell & { text: string })[];
  };
  cells: { read: number; occupying: number; timingNotes: number; unreadable: number; marginNotes: number };
  stays: { total: number; cellsMerged: number; acrossMonthEnd: number };
  conflicts: (Cell & { label: string; berth: string; start: string; end: string; overlaps: string })[];
  tooLong: (Cell & { vessel: string; vesselFt: number; berth: string; berthFt: number; start: string; end: string })[];
  unreadable: (Cell & { text: string; where: string })[];
  vessels: {
    total: number;
    spellings: number;
    withLength: number;
    /** Registry entries whose name and notes disagree. `booked` says whether one is stored. */
    contradictions: (Cell & { vessel: string; nameFt: number; loaFt: number; booked: boolean })[];
  };
  reviewItems: number;
};

export type ImportPlan = {
  /** Distinct berths the workbook names, in its own order. The writer maps them by name. */
  berths: { name: string; lengthFt: number | null }[];
  vessels: PlannedVessel[];
  bookings: PlannedBooking[];
  reviewItems: PlannedReviewItem[];
  reconciliation: Reconciliation;
};

/** Bytes to plan. Throws ImportError, with a reason a person can act on. */
export function planImport(bytes: Uint8Array): ImportPlan {
  return planFromWorkbook(readWorkbook(bytes));
}

export function planFromWorkbook(wb: XLSX.WorkBook): ImportPlan {
  const { entries, report } = parseGrids(wb);
  if (report.sheetsScanned.length === 0) {
    throw new ImportError(
      'That workbook has no sheet named for a year (1997, 1998 and so on), so there is no '
      + 'schedule in it to read.',
    );
  }
  if (entries.length === 0) {
    throw new ImportError(
      `That workbook's year sheets (${report.sheetsScanned.join(', ')}) hold no bookings the `
      + 'parser could place. Nothing would be imported.',
    );
  }

  const { bookings, unclassified, stats } = stitch(entries);
  const registry = parseRegistryBook(wb);
  const registryByName = new Map(registry.vessels.map((v) => [v.normalizedName, v]));

  const berths = distinctBerths(bookings);
  const vessels = plannedVessels(bookings, registryByName);
  const planned = classifyConflicts(bookings);
  const reviewItems = buildReviewItems(planned, unclassified, report, registryByName);

  return {
    berths,
    vessels,
    bookings: planned,
    reviewItems,
    reconciliation: reconcile({
      entries: entries.length, report, stats, planned, vessels, reviewItems, registry,
      spellings: new Set(entries.filter((e) => e.kind === 'vessel').map((e) => e.text)).size,
      unclassified,
    }),
  };
}

/** Piers first, then floats, then slips — the order the spreadsheet itself uses. */
const BERTH_ORDER = [
  'North Pier West', 'North Pier Face', 'North Pier East',
  'Inner Channel', 'South Float West', 'South Float East',
  'Small craft slips (institution boats)',
];

function distinctBerths(bookings: StitchedBooking[]) {
  const seen = new Map<string, number | null>();
  for (const b of bookings) if (!seen.has(b.berthName)) seen.set(b.berthName, b.berthLengthFt);
  const rank = (n: string) => { const i = BERTH_ORDER.indexOf(n); return i < 0 ? BERTH_ORDER.length : i; };
  return [...seen.entries()]
    .map(([name, lengthFt]) => ({ name, lengthFt }))
    .sort((a, b) => rank(a.name) - rank(b.name));
}

function plannedVessels(bookings: StitchedBooking[], registry: Map<string, RegistryVessel>): PlannedVessel[] {
  const out = new Map<string, PlannedVessel>();
  for (const b of bookings) {
    if (!b.normalizedVesselName || out.has(b.normalizedVesselName)) continue;
    const reg = registry.get(b.normalizedVesselName);
    out.set(b.normalizedVesselName, {
      display: b.label,
      normalized: b.normalizedVesselName,
      lengthFt: reg?.nameLengthFt ?? null,
      loaFt: reg?.loaFt ?? null,
      lengthSource: reg?.nameLengthFt != null ? 'registry_name' : null,
      operator: reg?.operator ?? null,
    });
  }
  return [...out.values()];
}

/**
 * Mark each stay that overlaps an earlier one on an exclusive berth.
 *
 * Done here, in the same domain functions the app uses, so the database's exclusion
 * constraint can act as an independent audit: an overlap left `active` would make the
 * insert fail, loudly, rather than store a double-booking. A conflict is kept as
 * `conflict_unresolved` — outside the constraint — because the history is what it was.
 */
function classifyConflicts(bookings: StitchedBooking[]): PlannedBooking[] {
  const byBerth = new Map<string, PlannedBooking[]>();
  const out: PlannedBooking[] = [];
  const sorted = [...bookings].sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  for (const b of sorted) {
    const accepted = byBerth.get(b.berthName) ?? [];
    const clash = capacityModeFor(b.berthName) === 'exclusive'
      ? accepted.find((o) => o.status === 'active'
          && overlaps({ start: b.start, end: b.end }, { start: o.start, end: o.end }))
      : undefined;
    const p: PlannedBooking = clash
      ? { ...b, status: 'conflict_unresolved', conflictWith: `${clash.label} (${clash.start}..${clash.end})` }
      : { ...b, status: 'active', conflictWith: null };
    accepted.push(p);
    byBerth.set(b.berthName, accepted);
    out.push(p);
  }
  return out;
}

function buildReviewItems(
  planned: PlannedBooking[],
  unclassified: ReturnType<typeof stitch>['unclassified'],
  report: ParseReport,
  registry: Map<string, RegistryVessel>,
): PlannedReviewItem[] {
  const items: PlannedReviewItem[] = [];
  const at = (p: PlannedBooking) => {
    const c = p.provenance[0];
    return { importYear: Number(c.sheet), importSheet: c.sheet, importRow: c.row, importCol: c.col };
  };

  planned.forEach((p, i) => {
    if (p.status !== 'conflict_unresolved') return;
    items.push({
      type: 'conflict', bookingIndex: i, berthName: p.berthName, vesselNormalized: null,
      rawText: p.label, detail: `${p.start}..${p.end} on ${p.berthName} overlaps ${p.conflictWith}`,
      ...at(p),
    });
  });

  planned.forEach((p, i) => {
    if (p.kind !== 'vessel' || !p.normalizedVesselName) return;
    const fit = checkFit(registry.get(p.normalizedVesselName)?.nameLengthFt ?? null, p.berthLengthFt);
    if (fit.verdict !== 'too_long') return;
    items.push({
      type: 'too_long', bookingIndex: i, berthName: p.berthName, vesselNormalized: p.normalizedVesselName,
      rawText: p.label, detail: `${fit.reason} (${p.start}..${p.end})`, ...at(p),
    });
  });

  for (const u of unclassified) {
    items.push({
      type: 'unclassified', bookingIndex: null, berthName: u.berthName, vesselNormalized: null,
      rawText: u.text, detail: `In ${u.berthName}, ${u.year}-${String(u.month).padStart(2, '0')} day ${u.startDay}`,
      importYear: u.year, importSheet: u.sheet, importRow: u.row, importCol: u.col,
    });
  }
  for (const o of report.orphanedGridCells) {
    items.push({
      type: 'unclassified', bookingIndex: null, berthName: null, vesselNormalized: null,
      rawText: o.text, detail: 'Found on a day-number row with no berth, so it cannot be attributed',
      importYear: Number(o.sheet), importSheet: o.sheet, importRow: o.row, importCol: o.col,
    });
  }
  return items;
}

function reconcile(x: {
  entries: number;
  report: ParseReport;
  stats: StitchStats;
  planned: PlannedBooking[];
  vessels: PlannedVessel[];
  reviewItems: PlannedReviewItem[];
  registry: ReturnType<typeof parseRegistryBook>;
  spellings: number;
  unclassified: ReturnType<typeof stitch>['unclassified'];
}): Reconciliation {
  const { report, stats, planned, vessels, reviewItems, registry } = x;
  const booked = new Set(vessels.map((v) => v.normalized));
  const cellOf = (p: PlannedBooking): Cell => {
    const c = p.provenance[0];
    return { sheet: c.sheet, row: c.row, col: c.col };
  };
  const registrySheets = new Set<string>(registry.sheetsRead);

  return {
    sheets: {
      yearGrids: report.sheetsScanned,
      registry: registry.sheetsRead,
      notRead: report.sheetsSkipped.filter((s) => !registrySheets.has(s.sheet)),
    },
    months: {
      resolved: report.monthBlocks,
      unaligned: report.blocksWithoutDayStrip,
      calendarUnverified: report.blocksWithUnverifiedCalendar,
    },
    defects: {
      carriedOverDecembers: report.carryOverBlocks,
      implausibleYears: report.headerYearAnomalies,
      orphanedCells: report.orphanedGridCells,
    },
    cells: {
      read: report.rawCells,
      occupying: stats.occupancyCells,
      timingNotes: stats.annotationsDropped,
      unreadable: stats.unclassifiedCount,
      marginNotes: report.marginCells,
    },
    stays: { total: planned.length, cellsMerged: stats.cellsMerged, acrossMonthEnd: stats.monthCrossingMerges },
    conflicts: planned
      .filter((p) => p.status === 'conflict_unresolved')
      .map((p) => ({ ...cellOf(p), label: p.label, berth: p.berthName, start: p.start, end: p.end, overlaps: p.conflictWith ?? '' })),
    tooLong: reviewItems
      .filter((r) => r.type === 'too_long' && r.bookingIndex != null)
      .map((r) => {
        const p = planned[r.bookingIndex!];
        return {
          ...cellOf(p), vessel: p.label,
          vesselFt: vessels.find((v) => v.normalized === p.normalizedVesselName)?.lengthFt ?? 0,
          berth: p.berthName, berthFt: p.berthLengthFt ?? 0, start: p.start, end: p.end,
        };
      }),
    unreadable: reviewItems
      .filter((r) => r.type === 'unclassified')
      .map((r) => ({ sheet: r.importSheet ?? '', row: r.importRow ?? 0, col: r.importCol ?? 0, text: r.rawText, where: r.detail })),
    vessels: {
      total: vessels.length,
      spellings: x.spellings,
      withLength: vessels.filter((v) => v.lengthFt != null).length,
      contradictions: registry.disagreements.map((d) => ({
        sheet: d.sourceSheet, row: d.sourceRow, col: 0,
        vessel: d.displayName, nameFt: d.nameLengthFt ?? 0, loaFt: d.loaFt ?? 0,
        booked: booked.has(d.normalizedName),
      })),
    },
    reviewItems: reviewItems.length,
  };
}
