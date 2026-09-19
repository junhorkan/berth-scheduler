import { describe, it, expect } from 'vitest';
import {
  clampMonth, step, currentMonth, lastYear, todayISO, isCurrentMonth,
  lastBookableISO, FIRST_YEAR, FIRST_MONTH, YEARS_AHEAD,
} from './nav';

/** A fixed instant so every assertion below is deterministic: 11:00 EDT, 19 Sep 2026. */
const NOW = new Date('2026-09-19T15:00:00Z');

describe('todayISO', () => {
  it('reports the date at the facility, not on the server', () => {
    expect(todayISO(NOW)).toBe('2026-09-19');
  });

  // The server runs in UTC. At 22:00 on 30 September in Woods Hole it is already
  // 1 October in UTC, and a UTC-based board would jump a month ahead of the wall.
  it('does not roll over a month early for a UTC server', () => {
    expect(todayISO(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30');
    expect(currentMonth(new Date('2026-10-01T02:00:00Z'))).toEqual({ year: 2026, month: 9 });
  });
});

describe('currentMonth', () => {
  it('is the month the facility is in', () => {
    expect(currentMonth(NOW)).toEqual({ year: 2026, month: 9 });
  });
});

describe('lastYear', () => {
  // The sample data ends in 2019; that is a fact about the sample, not a limit on
  // the facility. Pinning the bound to the data made future bookings unreachable.
  it('looks ahead of today rather than stopping at the imported data', () => {
    expect(lastYear(NOW)).toBe(2026 + YEARS_AHEAD);
    expect(lastYear(NOW)).toBeGreaterThan(2019);
  });
  it('gives the date inputs a matching ceiling', () => {
    expect(lastBookableISO(NOW)).toBe(`${2026 + YEARS_AHEAD}-12-31`);
  });
});

describe('clampMonth', () => {
  it('rolls month 0 back into the previous December', () => {
    expect(clampMonth(2010, 0, NOW)).toEqual({ year: 2009, month: 12 });
  });
  it('rolls month 13 forward into the next January', () => {
    expect(clampMonth(2010, 13, NOW)).toEqual({ year: 2011, month: 1 });
  });
  it('stops at the start of the data, which is August 1997', () => {
    expect(clampMonth(1997, 1, NOW)).toEqual({ year: FIRST_YEAR, month: FIRST_MONTH });
    expect(clampMonth(1990, 5, NOW)).toEqual({ year: FIRST_YEAR, month: FIRST_MONTH });
  });

  it('reaches today and the future instead of clamping to 2019', () => {
    expect(clampMonth(2026, 9, NOW)).toEqual({ year: 2026, month: 9 });
    expect(clampMonth(2027, 3, NOW)).toEqual({ year: 2027, month: 3 });
  });

  it('still refuses a year beyond the bookable horizon', () => {
    expect(clampMonth(2099, 5, NOW)).toEqual({ year: lastYear(NOW), month: 12 });
  });

  it('falls back to the current month on garbage input', () => {
    expect(clampMonth(NaN, NaN, NOW)).toEqual(currentMonth(NOW));
  });
});

describe('step', () => {
  it('walks forward across a year boundary', () => {
    expect(step(2010, 12, 1, NOW)).toEqual({ year: 2011, month: 1 });
  });
  it('walks backward across a year boundary', () => {
    expect(step(2011, 1, -1, NOW)).toEqual({ year: 2010, month: 12 });
  });
  it('walks past the end of the sample data without being blocked', () => {
    expect(step(2019, 12, 1, NOW)).toEqual({ year: 2020, month: 1 });
  });
  it('stops at the bookable horizon', () => {
    expect(step(lastYear(NOW), 12, 1, NOW)).toEqual({ year: lastYear(NOW), month: 12 });
  });
});

describe('isCurrentMonth', () => {
  it('recognizes the facility’s own month', () => {
    expect(isCurrentMonth(2026, 9, NOW)).toBe(true);
    expect(isCurrentMonth(2026, 8, NOW)).toBe(false);
    expect(isCurrentMonth(2010, 7, NOW)).toBe(false);
  });
});
