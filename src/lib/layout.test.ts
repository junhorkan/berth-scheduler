import { describe, it, expect } from 'vitest';
import { monthBounds, clipToMonth, packLanes, barGeometry, dayOf } from './layout';

describe('monthBounds', () => {
  it('handles a 31-day month', () => {
    expect(monthBounds(2010, 7)).toEqual({ start: '2010-07-01', end: '2010-07-31' });
  });
  it('handles February in a leap year', () => {
    expect(monthBounds(2012, 2).end).toBe('2012-02-29');
  });
});

describe('clipToMonth', () => {
  it('leaves a fully contained stay unclipped', () => {
    expect(clipToMonth({ start: '2010-07-05', end: '2010-07-09' }, 2010, 7)).toEqual({
      startDay: 5, endDay: 9, clippedStart: false, clippedEnd: false,
    });
  });

  it('clips and flags a stay that began in the previous month', () => {
    const c = clipToMonth({ start: '2010-06-28', end: '2010-07-03' }, 2010, 7)!;
    expect(c.startDay).toBe(1);
    expect(c.endDay).toBe(3);
    expect(c.clippedStart).toBe(true);
    expect(c.clippedEnd).toBe(false);
  });

  it('clips and flags a stay that continues into the next month', () => {
    const c = clipToMonth({ start: '2010-07-28', end: '2010-08-04' }, 2010, 7)!;
    expect(c.startDay).toBe(28);
    expect(c.endDay).toBe(31);
    expect(c.clippedStart).toBe(false);
    expect(c.clippedEnd).toBe(true);
  });

  it('flags both ends for a stay spanning the whole month', () => {
    const c = clipToMonth({ start: '2010-06-01', end: '2010-08-31' }, 2010, 7)!;
    expect(c).toEqual({ startDay: 1, endDay: 31, clippedStart: true, clippedEnd: true });
  });

  it('returns null for a stay entirely before or after the month', () => {
    expect(clipToMonth({ start: '2010-05-01', end: '2010-05-09' }, 2010, 7)).toBeNull();
    expect(clipToMonth({ start: '2010-09-01', end: '2010-09-09' }, 2010, 7)).toBeNull();
  });

  it('handles the 92-day real stay correctly in its middle month', () => {
    // M/Y BLUE TIDE, North Pier West, 2013-07-01..2013-09-30.
    const c = clipToMonth({ start: '2013-07-01', end: '2013-09-30' }, 2013, 8)!;
    expect(c).toEqual({ startDay: 1, endDay: 31, clippedStart: true, clippedEnd: true });
  });
});

describe('packLanes', () => {
  const span = (x: { startDay: number; endDay: number }) => x;

  it('puts non-overlapping spans in one lane', () => {
    const r = packLanes([{ startDay: 1, endDay: 3 }, { startDay: 5, endDay: 7 }], span);
    expect(r.map((x) => x.lane)).toEqual([0, 0]);
  });

  it('pushes an overlapping span to a second lane rather than hiding it', () => {
    const r = packLanes([{ startDay: 1, endDay: 10 }, { startDay: 5, endDay: 7 }], span);
    expect(r.map((x) => x.lane)).toEqual([0, 1]);
  });

  it('reuses a lane once it is free', () => {
    const r = packLanes(
      [{ startDay: 1, endDay: 5 }, { startDay: 3, endDay: 8 }, { startDay: 7, endDay: 9 }],
      span,
    );
    // third span overlaps the second but not the first, so it goes back to lane 0
    expect(r.map((x) => x.lane)).toEqual([0, 1, 0]);
  });

  it('treats a shared single day as overlapping', () => {
    const r = packLanes([{ startDay: 1, endDay: 5 }, { startDay: 5, endDay: 9 }], span);
    expect(r.map((x) => x.lane)).toEqual([0, 1]);
  });

  it('packs many concurrent spans into as many lanes as needed', () => {
    const items = Array.from({ length: 4 }, () => ({ startDay: 1, endDay: 10 }));
    expect(packLanes(items, span).map((x) => x.lane)).toEqual([0, 1, 2, 3]);
  });

  it('is stable: same input, same lanes', () => {
    const items = [{ startDay: 3, endDay: 6 }, { startDay: 1, endDay: 4 }];
    expect(packLanes(items, span)).toEqual(packLanes(items, span));
  });
});

describe('barGeometry', () => {
  it('places day 1 at the left edge', () => {
    expect(barGeometry(1, 1, 31).left).toBe(0);
  });
  it('makes a full-month bar span the whole track', () => {
    const g = barGeometry(1, 31, 31);
    expect(g.left).toBe(0);
    expect(g.width).toBeCloseTo(100, 6);
  });
  it('sizes a 4-day bar as 4/31 of the track', () => {
    expect(barGeometry(13, 16, 31).width).toBeCloseTo((4 / 31) * 100, 6);
  });
  it('places the last day flush to the right edge', () => {
    const g = barGeometry(31, 31, 31);
    expect(g.left + g.width).toBeCloseTo(100, 6);
  });
});

describe('dayOf', () => {
  it('extracts the day of month', () => expect(dayOf('2010-07-09')).toBe(9));
});
