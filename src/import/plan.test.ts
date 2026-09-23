import { existsSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ImportPlan, Reconciliation } from './plan';
import { planImport } from './plan';
import { readBytes } from './fromFile';

/**
 * Every figure the documentation states about the workbook, pinned here. Five of them
 * were stated as "locked into tests" for days while no test asserted them: 2,228 cells,
 * the 46 review items, the 20 recorded lengths, the 9 impossible fits, and which three
 * registry contradictions are actually stored. Skipped by name without the workbook,
 * which is the client's and is not in the repository.
 */
const WORKBOOK = 'data/Dock Schedule - Synthetic Sample.xlsx';
const HAS_WORKBOOK = existsSync(WORKBOOK);

describe.skipIf(!HAS_WORKBOOK)(`planImport against the real workbook (needs ${WORKBOOK})`, () => {
  let plan: ImportPlan;
  let r: Reconciliation;
  beforeAll(async () => {
    plan = await planImport(readBytes(WORKBOOK));
    r = plan.reconciliation;
  });

  /*
    These numbers moved, and the old ones were the bug.

    A booking drawn from the left edge of the grid — the blank columns beside the berth
    name, before the day strip begins — was dropped, because the parser read the START
    column and found no day for it. Fifteen merges in the file do that, two of them whole
    months of R/V GOLDEN COMPASS on North Pier West. The board showed those berths free
    for months the source says were full.

    The old total was also not a reconciliation of the FILE. "Reads 2,212 cells and
    accounts for every one" accounted for the 2,212 it had already chosen to count; the
    dropped cells never entered the ledger, so the arithmetic balanced by construction
    while 233 booked days sat outside it.
  */
  it('reads 2,228 cells and accounts for every one', () => {
    expect(r.cells.read).toBe(2228);
    // 2,191 occupy a berth; 29 are timing notes like "ETA 1200"; 8 could not be read.
    expect(r.cells.occupying + r.cells.timingNotes + r.cells.unreadable).toBe(2228);
    expect([r.cells.occupying, r.cells.timingNotes, r.cells.unreadable]).toEqual([2191, 29, 8]);
  });

  it('stitches the 2,191 occupying cells into 2,040 stays', () => {
    expect(r.stays).toEqual({ total: 2040, cellsMerged: 151, acrossMonthEnd: 54 });
    expect(plan.bookings).toHaveLength(2040);
  });

  it('reads every year grid and the registry, and names what it did not read', () => {
    expect(r.sheets.yearGrids).toHaveLength(23);
    expect(r.sheets.registry).toEqual(['Science', 'Yachts']);
    expect(r.sheets.notRead.map((s) => s.sheet).sort()).toEqual(['8YR Dock Summary', 'Tours']);
    expect(r.months.resolved).toBe(272);
  });

  it('finds exactly one double-booking in 23 years, and keeps it', () => {
    expect(r.conflicts).toHaveLength(1);
    const [c] = r.conflicts;
    expect([c.label, c.berth, c.start]).toEqual(['Utility work on pier face', 'South Float East', '2017-07-11']);
    expect(c.overlaps).toContain('OSV AMBER REEF');
  });

  it('finds 9 physically impossible fits, 6 of them single-day, the worst 170ft in 90ft', () => {
    expect(r.tooLong).toHaveLength(9);
    expect(r.tooLong.filter((t) => t.start === t.end)).toHaveLength(6);
    const worst = r.tooLong.reduce((a, b) => (b.vesselFt - b.berthFt > a.vesselFt - a.berthFt ? b : a));
    expect([worst.vessel, worst.vesselFt, worst.berthFt]).toEqual(['S/Y Clear Beacon', 170, 90]);
  });

  it('records a length for 20 of 419 vessels', () => {
    expect([r.vessels.withLength, r.vessels.total]).toEqual([20, 419]);
  });

  it('makes 47 review items: 1 conflict, 9 too long, 37 unreadable', () => {
    // 36 = 19 cells nobody could read, plus one per sheet holding entries on a row that
    // names no berth. They share a headline, so the queue folds them into a single row.
    const byType = (t: string) => plan.reviewItems.filter((i) => i.type === t).length;
    expect([byType('conflict'), byType('too_long'), byType('unclassified')]).toEqual([1, 9, 37]);
    expect(r.reviewItems).toBe(47);
  });

  it('reports all 434 entries that sit on a row naming no berth or outside the day strip', () => {
    // Found by asking whether the board showed everything in the file. It did not: these
    // were skipped in silence — 230 vessel names, 79 events, 25 closures — because their
    // row has a blank label or reads `North Finger Piers:`, a section header.
    const un = r.defects.unattributed;
    expect(un).toHaveLength(434);
    expect(new Set(un.map((u) => u.sheet)).size).toBe(17);
    for (const u of un) {
      expect(u.sheet).toMatch(/^\d{4}$/);
      expect(u.row).toBeGreaterThan(0);
      expect(u.col).toBeGreaterThan(0);
      expect(u.text.trim()).not.toBe('');
    }
    // Reported, never attributed: the schedule is exactly what it was before they were.
    expect(plan.bookings).toHaveLength(2040);
    expect(plan.berths.map((b) => b.name)).not.toContain('North Finger Piers');
  });

  it('keeps both answers for 3 registry contradictions, and says only 1 is ever stored', () => {
    // The docs said all three were stored with both values. Two are never booked, so
    // they never reach the database; the parse keeps both, the database keeps one.
    expect(r.vessels.contradictions.map((c) => [c.vessel, c.nameFt, c.loaFt, c.booked])).toEqual([
      ['R/V High Sound', 32, 65, false],
      ['Barge NORTHERN MARLIN', 24, 65, false],
      ['M/Y Western Strand', 52, 65, true],
    ]);
  });

  it('points every unreadable cell at its sheet, row and column', () => {
    // 19 cells, plus the per-sheet report of the rows that name no berth.
    expect(r.unreadable).toHaveLength(37);
    for (const u of r.unreadable) {
      expect(u.sheet).toMatch(/^\d{4}$/);
      expect(u.row).toBeGreaterThan(0);
      expect(u.col).toBeGreaterThan(0);
    }
  });
});
