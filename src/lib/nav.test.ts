import { describe, it, expect } from 'vitest';
import {
  clampMonth, step, currentMonth, firstYear, lastYear, todayISO, isCurrentMonth,
  firstBookableISO, lastBookableISO, YEARS_BACK, YEARS_AHEAD,
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

describe('the bookable window', () => {
  // Both bounds move with the current date. A fixed bound once made future bookings
  // saveable but unreachable, because the board could not navigate to them.
  it('reaches back far enough to record a season already past', () => {
    expect(firstYear(NOW)).toBe(2026 - YEARS_BACK);
  });
  it('reaches forward far enough to plan the next ones', () => {
    expect(lastYear(NOW)).toBe(2026 + YEARS_AHEAD);
  });
  it('gives the date inputs the same bounds as the navigation', () => {
    expect(firstBookableISO(NOW)).toBe(`${firstYear(NOW)}-01-01`);
    expect(lastBookableISO(NOW)).toBe(`${lastYear(NOW)}-12-31`);
  });
});

describe('clampMonth', () => {
  it('rolls month 0 back into the previous December', () => {
    expect(clampMonth(2025, 0, NOW)).toEqual({ year: 2024, month: 12 });
  });
  it('rolls month 13 forward into the next January', () => {
    expect(clampMonth(2025, 13, NOW)).toEqual({ year: 2026, month: 1 });
  });
  it('refuses a year before the window opens', () => {
    expect(clampMonth(1997, 1, NOW)).toEqual({ year: firstYear(NOW), month: 1 });
    expect(clampMonth(1990, 5, NOW)).toEqual({ year: firstYear(NOW), month: 1 });
  });

  it('reaches today and the future', () => {
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
    expect(step(2025, 12, 1, NOW)).toEqual({ year: 2026, month: 1 });
  });
  it('walks backward across a year boundary', () => {
    expect(step(2026, 1, -1, NOW)).toEqual({ year: 2025, month: 12 });
  });
  it('stops at the far end of the bookable window', () => {
    expect(step(lastYear(NOW), 12, 1, NOW)).toEqual({ year: lastYear(NOW), month: 12 });
  });
  it('stops at the near end of the bookable window', () => {
    expect(step(firstYear(NOW), 1, -1, NOW)).toEqual({ year: firstYear(NOW), month: 1 });
  });
});

describe('isCurrentMonth', () => {
  it('recognizes the facility’s own month', () => {
    expect(isCurrentMonth(2026, 9, NOW)).toBe(true);
    expect(isCurrentMonth(2026, 8, NOW)).toBe(false);
    expect(isCurrentMonth(2025, 7, NOW)).toBe(false);
  });
});
