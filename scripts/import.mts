/**
 * One-shot loader: legacy workbook -> Postgres.
 *
 * Also the mechanism behind "Reset to imported state", so it must be idempotent.
 *
 * Conflicts are pre-classified in JavaScript using the SAME domain logic the UI uses
 * (src/domain/conflicts.ts), then everything is bulk inserted. The database's exclusion
 * constraint therefore acts as an independent audit of that logic: if the two ever
 * disagree, the insert fails loudly instead of quietly storing an overlap.
 */
import { connect } from './db.mjs';
import { parseWorkbook } from '../src/import/parseWorkbook';
import { stitch, type StitchedBooking } from '../src/import/stitch';
import { parseRegistry } from '../src/import/parseRegistry';
import { capacityModeFor } from '../src/domain/normalize';
import { overlaps } from '../src/domain/conflicts';
import { checkFit } from '../src/domain/fit';

const WORKBOOK = 'data/Dock Schedule - Synthetic Sample.xlsx';

const { entries, report } = parseWorkbook(WORKBOOK);
const { bookings, unclassified, stats } = stitch(entries);
const { vessels: registry, disagreements } = parseRegistry(WORKBOOK);

// ---------------------------------------------------------------- berths
const berthMap = new Map<string, { name: string; lengthFt: number | null; order: number }>();
for (const b of bookings) {
  if (!berthMap.has(b.berthName)) {
    berthMap.set(b.berthName, { name: b.berthName, lengthFt: b.berthLengthFt, order: berthMap.size });
  }
}
// Present them the way the spreadsheet does: piers first, then floats, then slips.
const BERTH_ORDER = [
  'North Pier West', 'North Pier Face', 'North Pier East',
  'Inner Channel', 'South Float West', 'South Float East',
  'Small craft slips (institution boats)',
];
const berths = [...berthMap.values()].sort(
  (a, b) => BERTH_ORDER.indexOf(a.name) - BERTH_ORDER.indexOf(b.name),
);

// --------------------------------------------------------------- vessels
const registryByName = new Map(registry.map((v) => [v.normalizedName, v]));
const vesselMap = new Map<string, { display: string; normalized: string }>();
for (const b of bookings) {
  if (b.normalizedVesselName && !vesselMap.has(b.normalizedVesselName)) {
    vesselMap.set(b.normalizedVesselName, { display: b.label, normalized: b.normalizedVesselName });
  }
}

// ------------------------------------------- pre-classify conflicts in JS
type Prepared = StitchedBooking & { status: 'active' | 'conflict_unresolved'; conflictWith?: string };
const byBerth = new Map<string, Prepared[]>();
const prepared: Prepared[] = [];

for (const b of [...bookings].sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0))) {
  const exclusive = capacityModeFor(b.berthName) === 'exclusive';
  const accepted = byBerth.get(b.berthName) ?? [];
  let clash: Prepared | undefined;
  if (exclusive) {
    clash = accepted.find(
      (o) => o.status === 'active' && overlaps({ start: b.start, end: b.end }, { start: o.start, end: o.end }),
    );
  }
  const p: Prepared = clash
    ? { ...b, status: 'conflict_unresolved', conflictWith: `${clash.label} (${clash.start}..${clash.end})` }
    : { ...b, status: 'active' };
  accepted.push(p);
  byBerth.set(b.berthName, accepted);
  prepared.push(p);
}

const conflicted = prepared.filter((p) => p.status === 'conflict_unresolved');

// ------------------------------------------------------------------ load
const sql = connect({ max: 3 });
try {
  await sql`truncate review_items, bookings, vessels, berths restart identity cascade`;

  const berthRows = await sql`
    insert into berths ${sql(
      berths.map((b, i) => ({
        name: b.name,
        length_ft: b.lengthFt,
        capacity_mode: capacityModeFor(b.name),
        display_order: i,
      })),
    )} returning id, name`;
  const berthId = new Map(berthRows.map((r) => [r.name as string, r.id as string]));

  const vesselRows = await sql`
    insert into vessels ${sql(
      [...vesselMap.values()].map((v) => {
        const reg = registryByName.get(v.normalized);
        return {
          canonical_name: v.display,
          normalized_name: v.normalized,
          length_ft: reg?.nameLengthFt ?? null,
          loa_ft: reg?.loaFt ?? null,
          length_source: reg?.nameLengthFt != null ? 'registry_name' : null,
          operator: reg?.operator ?? null,
          notes: null,
        };
      }),
    )} returning id, normalized_name`;
  const vesselId = new Map(vesselRows.map((r) => [r.normalized_name as string, r.id as string]));

  // Insert bookings in batches; provenance keeps the first contributing cell.
  const BATCH = 250;
  const bookingIdByKey = new Map<string, string>();
  for (let i = 0; i < prepared.length; i += BATCH) {
    const slice = prepared.slice(i, i + BATCH);
    const rows = await sql`
      insert into bookings ${sql(
        slice.map((p) => {
          const first = p.provenance[0];
          return {
            berth_id: berthId.get(p.berthName)!,
            vessel_id: p.normalizedVesselName ? vesselId.get(p.normalizedVesselName)! : null,
            kind: p.kind,
            status: p.status,
            label: p.label,
            start_date: p.start,
            end_date: p.end,
            notes: p.conflictWith ? `Imported overlap with ${p.conflictWith}` : null,
            source: 'import',
            import_year: Number(first.sheet),
            import_sheet: first.sheet,
            import_row: first.row,
            import_col: first.col,
          };
        }),
      )} returning id, berth_id, start_date, label`;
    for (const r of rows) {
      bookingIdByKey.set(`${r.berth_id}|${r.start_date.toISOString().slice(0, 10)}|${r.label}`, r.id as string);
    }
  }

  // ---------------------------------------------------------- review items
  // Every row must carry the SAME keys: postgres.js takes its column list from the
  // first object in a bulk insert, and a missing key would arrive as undefined.
  type ReviewRow = {
    type: string;
    booking_id: string | null;
    vessel_id: string | null;
    berth_id: string | null;
    raw_text: string | null;
    detail: string | null;
    import_year: number | null;
    import_sheet: string | null;
    import_row: number | null;
    import_col: number | null;
  };
  const items: ReviewRow[] = [];
  const reviewRow = (over: Partial<ReviewRow> & { type: string }): ReviewRow => ({
    booking_id: null, vessel_id: null, berth_id: null,
    raw_text: null, detail: null,
    import_year: null, import_sheet: null, import_row: null, import_col: null,
    ...over,
  });

  for (const p of conflicted) {
    const key = `${berthId.get(p.berthName)}|${p.start}|${p.label}`;
    items.push(reviewRow({
      type: 'conflict',
      booking_id: bookingIdByKey.get(key) ?? null,
      berth_id: berthId.get(p.berthName)!,
      raw_text: p.label,
      detail: `${p.start}..${p.end} on ${p.berthName} overlaps ${p.conflictWith}`,
      import_year: Number(p.provenance[0].sheet),
      import_sheet: p.provenance[0].sheet,
      import_row: p.provenance[0].row,
      import_col: p.provenance[0].col,
    }));
  }

  // Vessels too long for a berth they were actually assigned to.
  let tooLong = 0;
  for (const p of prepared) {
    if (p.kind !== 'vessel' || !p.normalizedVesselName) continue;
    const len = registryByName.get(p.normalizedVesselName)?.nameLengthFt ?? null;
    const fit = checkFit(len, p.berthLengthFt);
    if (fit.verdict === 'too_long') {
      tooLong++;
      items.push(reviewRow({
        type: 'too_long',
        booking_id: bookingIdByKey.get(`${berthId.get(p.berthName)}|${p.start}|${p.label}`) ?? null,
        vessel_id: vesselId.get(p.normalizedVesselName)!,
        berth_id: berthId.get(p.berthName)!,
        raw_text: p.label,
        detail: `${fit.reason} (${p.start}..${p.end})`,
        import_year: Number(p.provenance[0].sheet),
        import_sheet: p.provenance[0].sheet,
        import_row: p.provenance[0].row,
        import_col: p.provenance[0].col,
      }));
    }
  }

  // Vessels with no recorded length are NOT written as review items. There were 398 of
  // them — 93% of the queue, all saying the same thing, burying the items that need a
  // decision — and a stored count goes stale the moment a booking is cancelled or a
  // length is cleared. getMissingLengthSummary() derives it instead. The Vessels tab,
  // ordered by bookings blocked, is where that work actually happens.
  const missing = [...new Set(
    prepared.map((p) => p.normalizedVesselName).filter((n): n is string => Boolean(n)),
  )].filter((norm) => registryByName.get(norm)?.nameLengthFt == null).length;

  // Cells the importer could not classify, plus cells orphaned on damaged grid rows.
  for (const u of unclassified) {
    items.push(reviewRow({
      type: 'unclassified',
      raw_text: u.text,
      detail: `In ${u.berthName}, ${u.year}-${String(u.month).padStart(2, '0')} day ${u.startDay}`,
      import_year: u.year, import_sheet: u.sheet, import_row: u.row, import_col: u.col,
    }));
  }
  for (const o of report.orphanedGridCells) {
    items.push(reviewRow({
      type: 'unclassified',
      raw_text: o.text,
      detail: 'Found on a day-number row with no berth, so it cannot be attributed',
      import_year: Number(o.sheet), import_sheet: o.sheet, import_row: o.row, import_col: o.col,
    }));
  }

  for (let i = 0; i < items.length; i += 250) {
    await sql`insert into review_items ${sql(items.slice(i, i + 250))}`;
  }

  // ------------------------------------------------- snapshot for Reset
  // The deployed app is public and unauthenticated by design, so anyone can edit it.
  // A snapshot taken here is what makes that safe: "Reset to imported state" restores
  // from these tables, which is faster and far more reliable than re-parsing a
  // spreadsheet inside a serverless function.
  for (const t of ['berths', 'vessels', 'bookings', 'review_items']) {
    await sql.unsafe(`drop table if exists ${t}_seed`);
    await sql.unsafe(`create table ${t}_seed as select * from ${t}`);
  }

  // ------------------------------------------------------------- report
  const [counts] = await sql`
    select
      (select count(*)::int from berths)   as berths,
      (select count(*)::int from vessels)  as vessels,
      (select count(*)::int from bookings) as bookings,
      (select count(*)::int from bookings where status='active') as active,
      (select count(*)::int from bookings where status='conflict_unresolved') as unresolved,
      (select count(*)::int from review_items) as review_items`;

  console.log('\n========== IMPORT RECONCILIATION ==========');
  console.log(`  source cells read            ${report.rawCells}`);
  console.log(`    occupancy                  ${stats.occupancyCells}`);
  console.log(`    annotations (occupy none)  ${stats.annotationsDropped}`);
  console.log(`    unclassified               ${stats.unclassifiedCount}`);
  console.log(`  orphaned on damaged rows     ${report.orphanedGridCells.length}`);
  console.log(`  margin cells (notes)         ${report.marginCells}`);
  console.log('  ---');
  console.log(`  cells merged into stays      ${stats.cellsMerged} (${stats.monthCrossingMerges} across a month end)`);
  console.log(`  stays loaded                 ${counts.bookings}  (expected ${prepared.length})`);
  console.log(`    active                     ${counts.active}`);
  console.log(`    conflict_unresolved        ${counts.unresolved}`);
  console.log('  ---');
  console.log(`  berths                       ${counts.berths}`);
  console.log(`  vessels                      ${counts.vessels}`);
  console.log(`    with a known length        ${[...vesselMap.keys()].filter((n) => registryByName.get(n)?.nameLengthFt != null).length}`);
  console.log(`  review items                 ${counts.review_items}`);
  console.log(`    conflicts                  ${conflicted.length}`);
  console.log(`    too long for berth         ${tooLong}`);
  console.log(`    missing length             ${missing}`);
  console.log(`    unclassified/orphaned      ${unclassified.length + report.orphanedGridCells.length}`);
  console.log('  ---');
  console.log(`  registry length disagreements ${disagreements.length} (kept, not reconciled)`);
  console.log(`  month blocks                  ${report.monthBlocks}, unresolved ${report.blocksWithoutDayStrip.length}`);
  console.log(`  header-year typos overridden  ${report.headerYearAnomalies.length}`);
  console.log('===========================================\n');

  if (counts.bookings !== prepared.length) {
    throw new Error(`Row count mismatch: loaded ${counts.bookings}, expected ${prepared.length}`);
  }
} catch (e) {
  console.error('IMPORT FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
