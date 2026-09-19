import { describe, it, expect } from 'vitest';
import { parseWorkbook } from './parseWorkbook';
import { stitch } from './stitch';
import type { RawEntry } from './parseWorkbook';

function raw(over: Partial<RawEntry> = {}): RawEntry {
  return {
    year: 2010, month: 7,
    berthLabel: "South Float West - 90'", berthName: 'South Float West', berthLengthFt: 90,
    startDay: 1, endDay: 1,
    text: 'R/V Long Ketch', kind: 'vessel',
    sheet: '2010', row: 10, col: 5,
    ...over,
  };
}

describe('stitch — merging rules', () => {
  it('merges consecutive single-day cells of the same vessel into one stay', () => {
    const { bookings, stats } = stitch([
      raw({ startDay: 2, endDay: 2 }),
      raw({ startDay: 3, endDay: 3 }),
      raw({ startDay: 4, endDay: 4 }),
    ]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].start).toBe('2010-07-02');
    expect(bookings[0].end).toBe('2010-07-04');
    expect(bookings[0].provenance).toHaveLength(3);
    expect(stats.cellsMerged).toBe(2);
  });

  it('does NOT merge across a gap — separate visits stay separate', () => {
    const { bookings } = stitch([raw({ startDay: 7, endDay: 7 }), raw({ startDay: 9, endDay: 9 })]);
    expect(bookings).toHaveLength(2);
  });

  it('stitches a stay that crosses a month boundary into one booking', () => {
    const { bookings, stats } = stitch([
      raw({ month: 7, startDay: 28, endDay: 31 }),
      raw({ month: 8, startDay: 1, endDay: 3 }),
    ]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].start).toBe('2010-07-28');
    expect(bookings[0].end).toBe('2010-08-03');
    expect(stats.monthCrossingMerges).toBe(1);
  });

  it('stitches across a YEAR boundary too', () => {
    const { bookings } = stitch([
      raw({ year: 2010, month: 12, startDay: 30, endDay: 31 }),
      raw({ year: 2011, month: 1, startDay: 1, endDay: 2 }),
    ]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].start).toBe('2010-12-30');
    expect(bookings[0].end).toBe('2011-01-02');
  });

  it('never merges different vessels, even when adjacent', () => {
    const { bookings } = stitch([
      raw({ startDay: 2, endDay: 2, text: 'R/V Long Ketch' }),
      raw({ startDay: 3, endDay: 3, text: 'OSV AMBER REEF' }),
    ]);
    expect(bookings).toHaveLength(2);
  });

  it('never merges the same vessel across different berths', () => {
    const { bookings } = stitch([
      raw({ startDay: 2, endDay: 2, berthName: 'South Float West' }),
      raw({ startDay: 3, endDay: 3, berthName: 'South Float East' }),
    ]);
    expect(bookings).toHaveLength(2);
  });

  it('merges case-variant spellings as one vessel', () => {
    const { bookings } = stitch([
      raw({ startDay: 2, endDay: 2, text: 'Barge SALT DORY' }),
      raw({ startDay: 3, endDay: 3, text: 'Barge Salt Dory' }),
    ]);
    expect(bookings).toHaveLength(1);
  });

  it('drops annotations from occupancy but hands them back for review', () => {
    const { bookings, annotations, stats } = stitch([
      raw({ startDay: 2, endDay: 2 }),
      raw({ startDay: 3, endDay: 3, text: 'ETA 1200', kind: 'annotation' }),
    ]);
    expect(bookings).toHaveLength(1);
    expect(annotations).toHaveLength(1);
    expect(stats.annotationsDropped).toBe(1);
  });

  it('hands back unclassified cells instead of discarding them', () => {
    const { bookings, unclassified } = stitch([
      raw({ text: 'Concrete work near test wells', kind: 'unclassified' }),
    ]);
    expect(bookings).toHaveLength(0);
    expect(unclassified).toHaveLength(1);
  });

  it('gives events and closures no vessel identity', () => {
    const { bookings } = stitch([
      raw({ text: 'Community sail day', kind: 'event' }),
      raw({ startDay: 5, text: 'Pier repair - no docking', kind: 'closure' }),
    ]);
    expect(bookings.every((b) => b.normalizedVesselName === null)).toBe(true);
  });
});

describe('stitch — against the real workbook', () => {
  const { entries } = parseWorkbook('data/Dock Schedule - Synthetic Sample.xlsx');
  const { bookings, stats } = stitch(entries);

  it('reconciles: every cell is a booking, an annotation, or unclassified', () => {
    expect(stats.occupancyCells + stats.annotationsDropped + stats.unclassifiedCount)
      .toBe(entries.length);
  });

  it('collapses 2,176 occupancy cells into 2,031 real stays', () => {
    expect(stats.occupancyCells).toBe(2176);
    expect(bookings).toHaveLength(2031);
    // bookings + merged cells must equal the cells we started from
    expect(bookings.length + stats.cellsMerged).toBe(stats.occupancyCells);
  });

  it('finds 49 month-crossing stays that the spreadsheet showed as separate bars', () => {
    expect(stats.monthCrossingMerges).toBe(49);
  });

  it('yields 418 distinct vessels after folding name variants', () => {
    const names = new Set(
      bookings.filter((b) => b.normalizedVesselName).map((b) => b.normalizedVesselName),
    );
    expect(names.size).toBe(418);
  });

  it('dates every booking inside 1997-2019, with no year pushed into the future', () => {
    // Guards the 'NOVEMBER 2018' typo on the 2010 sheet from ever coming back.
    for (const b of bookings) {
      const y = Number(b.start.slice(0, 4));
      expect(y).toBeGreaterThanOrEqual(1997);
      expect(y).toBeLessThanOrEqual(2019);
    }
  });

  it('merges the carry-over Decembers instead of duplicating them', () => {
    const keys = bookings.map((b) => `${b.berthName}|${b.label.toUpperCase()}|${b.start}|${b.end}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces only valid, ordered date ranges', () => {
    for (const b of bookings) {
      expect(b.start <= b.end).toBe(true);
      expect(b.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps long multi-month stays traceable to multiple source cells', () => {
    const long = bookings.filter(
      (b) => (Date.parse(b.end) - Date.parse(b.start)) / 86_400_000 + 1 > 31,
    );
    expect(long).toHaveLength(11);
    // A 92-day stay must be evidenced by more than one cell, or it is an over-merge.
    for (const b of long) expect(b.provenance.length).toBeGreaterThan(1);
  });
});
