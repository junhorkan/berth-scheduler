/**
 * A reconciliation, as text for a terminal.
 *
 * Shared by `npm run import` and `npm run import:check`, so the dry run prints exactly
 * what a real import would. `npm run import:check` prints the same Reconciliation
 * as a page instead. Pure.
 */
import type { Reconciliation } from './plan';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n = (x: number) => x.toLocaleString('en-US');
const at = (c: { sheet: string; row: number; col?: number }) =>
  `sheet ${c.sheet}, row ${c.row}${c.col ? `, col ${c.col}` : ''}`;

export function formatReconciliation(r: Reconciliation): string {
  const L: string[] = [];
  const line = (s = '') => L.push(s);
  const list = <T>(title: string, rows: T[], fmt: (t: T) => string) => {
    line(`${title} (${rows.length})`);
    if (rows.length === 0) line('    none');
    for (const x of rows) line(`    ${fmt(x)}`);
  };

  line('RECONCILIATION');
  line(`  sheets      ${r.sheets.yearGrids.length} year grids · registry: ${r.sheets.registry.join(', ') || 'none'}`);
  for (const s of r.sheets.notRead) line(`              not read: ${s.sheet} (${s.reason})`);
  line(`  months      ${n(r.months.resolved)} resolved`
    + (r.months.unaligned.length ? ` · ${r.months.unaligned.length} could not be aligned` : '')
    + (r.months.calendarUnverified.length ? ` · ${r.months.calendarUnverified.length} calendar-unverified` : ''));
  line(`  cells       ${n(r.cells.read)} read = ${n(r.cells.occupying)} occupying a berth`
    + ` + ${n(r.cells.timingNotes)} timing notes + ${n(r.cells.unreadable)} unreadable`);
  line(`  stays       ${n(r.cells.occupying)} occupying cells → ${n(r.stays.total)} stays`
    + ` (${n(r.stays.cellsMerged)} merged, ${n(r.stays.acrossMonthEnd)} across a month end)`);
  line(`  vessels     ${n(r.vessels.spellings)} spellings → ${n(r.vessels.total)} vessels,`
    + ` ${n(r.vessels.withLength)} with a recorded length`);
  line(`  review      ${n(r.reviewItems)} items`);
  line();
  line('SOURCE DEFECTS FOUND AND HANDLED');
  list('  December carried into the next year\'s sheet, merged not duplicated',
    r.defects.carriedOverDecembers, (d) => `sheet ${d.sheet} opens with ${MONTHS[d.month - 1]} ${d.year}`);
  list('  Headers stating an impossible year, where the sheet\'s year was used',
    r.defects.implausibleYears, (d) => `sheet ${d.sheet}, row ${d.row}: says ${MONTHS[d.month - 1]} ${d.statedYear}, read as ${d.usedYear}`);
  // Stated once here, as a defect, and listed once below among the unreadable cells —
  // not twice. Where they are is what matters for the defect; the cells are below.
  const orphans = r.defects.orphanedCells;
  const rows = [...new Set(orphans.map((o) => `${o.sheet} row ${o.row}`))];
  line(`  Names typed over a day-number row, so they belong to no berth (${orphans.length})`);
  line(orphans.length ? `    ${rows.join(', ')} — each is listed below` : '    none');
  // Reported per sheet: 373 cells listed one by one would bury everything above them.
  const un = r.defects.unattributed;
  const bySheet = new Map<string, number>();
  for (const u of un) bySheet.set(u.sheet, (bySheet.get(u.sheet) ?? 0) + 1);
  line(`  Entries on a row that names no berth, so they cannot be attributed (${un.length})`);
  line(un.length
    ? `    ${[...bySheet].map(([s, n2]) => `${s}: ${n2}`).join(', ')}`
    : '    none');
  line();
  line('WHAT THE SCHEDULE HOLDS');
  list('  Double-bookings, kept rather than deleted',
    r.conflicts, (c) => `${c.label} · ${c.berth} · ${c.start}${c.end !== c.start ? `..${c.end}` : ''} · overlaps ${c.overlaps} · ${at(c)}`);
  list('  Vessels too long for their berth',
    r.tooLong, (t) => `${t.vessel} · ${t.vesselFt}ft in ${t.berth}, ${t.berthFt}ft · ${t.start}${t.end !== t.start ? `..${t.end}` : ''} · ${at(t)}`);
  list('  Cells the parser would not guess at',
    r.unreadable, (u) => `"${u.text}" · ${u.where} · ${at(u)}`);
  list('  Registry entries that contradict themselves, both values kept',
    r.vessels.contradictions, (c) => `${c.vessel} · name says ${c.nameFt}ft, notes say LOA ${c.loaFt}ft · ${c.booked ? 'booked, stored with both' : 'never booked, so not stored'} · ${at(c)}`);
  return L.join('\n');
}
