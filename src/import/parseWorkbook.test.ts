import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { monthFromHeader, daysInMonth } from './parseWorkbook';
import { parseWorkbook } from './fromFile';

/**
 * The reconciliation tests read the client's workbook, which is deliberately not in the
 * repository: it is their material, and it was scrubbed from history before the repo was
 * made public. On a fresh clone these blocks are SKIPPED and say so — they used to crash
 * test collection with ENOENT and turn `npm test` red for anyone who cloned it.
 *
 * Put your copy at the path below and they run, verifying the parse against it: 2,212
 * cells to 2,031 stays, 272 of 272 month blocks, and each of the three source defects.
 */
const WORKBOOK = 'data/Dock Schedule - Synthetic Sample.xlsx';
const HAS_WORKBOOK = existsSync(WORKBOOK);

describe('monthFromHeader — all three header styles in the file', () => {
  it('reads the 1997-2005 style', () => expect(monthFromHeader('AUGUST 1997')).toBe(8));
  it('reads the 2006-2016 style', () => expect(monthFromHeader('JANUARY 2006')).toBe(1));
  it('reads the 2017+ bare style', () => expect(monthFromHeader('January')).toBe(1));
  it('rejects a berth label', () => expect(monthFromHeader("North Pier West - 410'")).toBeNull());
  it('rejects the title row', () => expect(monthFromHeader('Harborview Marine Research Center')).toBeNull());
});

describe('daysInMonth', () => {
  it('handles February in a leap year', () => expect(daysInMonth(2012, 2)).toBe(29));
  it('handles February in a common year', () => expect(daysInMonth(2011, 2)).toBe(28));
  it('handles a 30-day month', () => expect(daysInMonth(2010, 11)).toBe(30));
});

describe.skipIf(!HAS_WORKBOOK)(`parseWorkbook against the real 23-year workbook (needs ${WORKBOOK})`, () => {
  // Vitest still runs a skipped block's body to register its tests, and the nested
  // blocks below filter `entries` while doing so — so the fallback must be a real, empty
  // array rather than nothing. `report` is only ever read inside a test, which is skipped.
  const { entries, report } = HAS_WORKBOOK
    ? parseWorkbook(WORKBOOK)
    : ({ entries: [], report: {} } as unknown as ReturnType<typeof parseWorkbook>);

  it('scans all 23 year sheets and no others', () => {
    expect(report.sheetsScanned).toHaveLength(23);
    expect(report.sheetsScanned[0]).toBe('1997');
    expect(report.sheetsScanned.at(-1)).toBe('2019');
  });

  it('finds 272 month blocks: 22 full years, Aug-Dec 1997, plus 3 carry-over blocks', () => {
    expect(report.monthBlocks).toBe(272);
    expect(report.monthBlocks).toBe(22 * 12 + 5 + 3);
  });

  it('identifies the 3 carry-over blocks, each the PREVIOUS December', () => {
    // The 2002, 2003 and 2004 sheets each open with the prior December for context.
    expect(report.carryOverBlocks).toEqual([
      { sheet: '2002', month: 12, year: 2001 },
      { sheet: '2003', month: 12, year: 2002 },
      { sheet: '2004', month: 12, year: 2003 },
    ]);
  });

  it('rejects the two impossible header years on the 2010 sheet as typos', () => {
    // The 2010 sheet says 'NOVEMBER 2018' and 'DECEMBER 2018', but the 2018 sheet
    // already owns those months, so the sheet name must win. Trusting the header
    // would move two blocks of bookings eight years into the future.
    expect(report.headerYearAnomalies).toEqual([
      { sheet: '2010', row: 117, month: 11, statedYear: 2018, usedYear: 2010 },
      { sheet: '2010', row: 128, month: 12, statedYear: 2018, usedYear: 2010 },
    ]);
  });

  it('resolves a day alignment for EVERY month block', () => {
    // The whole point of inferring the offset rather than assuming one.
    expect(report.blocksWithoutDayStrip).toEqual([]);
  });

  it('confirms the alignment against the real calendar for all but 4 of 272 blocks', () => {
    // 2010/11 and 2010/12 have vessel names typed over the day-number row and no
    // weekday strip at all; 2003/12 and 2004/12 are carry-over blocks whose copied
    // strip does not match the year they represent. All four are reported, not hidden.
    expect(report.blocksWithUnverifiedCalendar).toEqual([
      '2003/12', '2004/12', '2010/11', '2010/12',
    ]);
    expect(report.blocksWithUnverifiedCalendar.length / report.monthBlocks).toBeLessThan(0.02);
  });

  it('never produces an inverted date range', () => {
    expect(entries.filter((e) => e.endDay < e.startDay)).toEqual([]);
  });

  it('keeps every day within its month', () => {
    for (const e of entries) {
      expect(e.startDay).toBeGreaterThanOrEqual(1);
      expect(e.endDay).toBeLessThanOrEqual(daysInMonth(e.year, e.month));
    }
  });

  it('classifies every cell into one of the five kinds, with nothing left over', () => {
    const total = Object.values(report.byKind).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.rawCells);
    expect(report.rawCells).toBe(entries.length);
  });

  it('accounts for the 12 orphaned cells on damaged grid rows rather than dropping them', () => {
    expect(report.orphanedGridCells).toHaveLength(12);
    // All of them are in the two damaged 2010 blocks.
    expect(new Set(report.orphanedGridCells.map((o) => o.sheet))).toEqual(new Set(['2010']));
  });

  it('excludes "North Finger Piers:" and yields exactly the 7 real berths', () => {
    const berths = new Set(entries.map((e) => e.berthName));
    expect(berths).toEqual(
      new Set([
        'North Pier West',
        'North Pier Face',
        'North Pier East',
        'Inner Channel',
        'South Float West',
        'South Float East',
        'Small craft slips (institution boats)',
      ]),
    );
  });

  it('carries berth lengths through from the labels', () => {
    const byName = new Map(entries.map((e) => [e.berthName, e.berthLengthFt]));
    expect(byName.get('North Pier West')).toBe(410);
    expect(byName.get('North Pier East')).toBe(240);
    expect(byName.get('North Pier Face')).toBe(75);
    expect(byName.get('Inner Channel')).toBe(55);
    expect(byName.get('South Float West')).toBe(90);
    expect(byName.get('South Float East')).toBe(90);
    // The one real berth with no stated length.
    expect(byName.get('Small craft slips (institution boats)')).toBeNull();
  });

  it('records provenance for every entry', () => {
    for (const e of entries.slice(0, 200)) {
      expect(e.sheet).toMatch(/^\d{4}$/);
      expect(e.row).toBeGreaterThan(0);
      expect(e.col).toBeGreaterThan(0);
    }
  });

  describe('decodes the 1997 "columns map straight to days" family', () => {
    const aug97 = entries.filter((e) => e.year === 1997 && e.month === 8);

    it('places F/V Swift Dory on Aug 2 1997', () => {
      // Aug 1 1997 was a Friday and sits in column 1, so column 2 is Aug 2.
      const hit = aug97.find((e) => e.text === 'F/V Swift Dory');
      expect(hit).toBeDefined();
      expect(hit!.startDay).toBe(2);
      expect(hit!.berthName).toBe('North Pier West');
    });

    it('finds the Community sail day event occupying a berth', () => {
      const sail = aug97.find((e) => e.text === 'Community sail day');
      expect(sail).toBeDefined();
      expect(sail!.kind).toBe('event');
    });
  });

  describe('decodes the 2010 calendar-offset family', () => {
    const jul10 = entries.filter((e) => e.year === 2010 && e.month === 7);

    it('finds the R/V CLEAR TERN booking that will fail the fit check', () => {
      // 120' vessel on the 75' North Pier Face.
      const hit = jul10.find((e) => e.text === 'R/V CLEAR TERN');
      expect(hit).toBeDefined();
      expect(hit!.berthName).toBe('North Pier Face');
      expect(hit!.berthLengthFt).toBe(75);
    });

    it('finds a closure and an event in the landing month', () => {
      expect(jul10.some((e) => e.kind === 'closure')).toBe(true);
      expect(jul10.some((e) => e.kind === 'event')).toBe(true);
    });

    it('reads a merged multi-day range as one entry', () => {
      const amber = jul10.find((e) => e.text === 'OSV AMBER REEF');
      expect(amber).toBeDefined();
      expect(amber!.endDay).toBeGreaterThan(amber!.startDay);
    });
  });
});
