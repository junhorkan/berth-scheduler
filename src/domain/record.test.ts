import { describe, it, expect } from 'vitest';
import { hasEnded, ENDED_REFUSAL } from './record';

const TODAY = '2026-09-22';

describe('hasEnded', () => {
  it('is true for a booking that finished yesterday', () => {
    expect(hasEnded('2026-09-21', TODAY)).toBe(true);
  });

  it('is true for every booking in the supplied workbook, which all ended in 2019', () => {
    expect(hasEnded('2019-12-31', TODAY)).toBe(true);
    expect(hasEnded('1997-08-02', TODAY)).toBe(true);
  });

  // The end date is inclusive: the vessel is still in the berth today, so the entry is
  // still work. Getting this wrong closes a booking a day early and locks a coordinator
  // out of the stay they are standing in front of.
  it('is false on the booking\'s own last day', () => {
    expect(hasEnded(TODAY, TODAY)).toBe(false);
  });

  it('is false for a booking that is still running', () => {
    expect(hasEnded('2026-09-24', TODAY)).toBe(false);
  });

  it('is false for a booking that has not started', () => {
    expect(hasEnded('2026-10-03', TODAY)).toBe(false);
  });

  // Whole-year and whole-month boundaries are where a string compare would break if
  // anyone were tempted to compare these as numbers or as Date objects.
  it('compares across a year boundary', () => {
    expect(hasEnded('2025-12-31', '2026-01-01')).toBe(true);
    expect(hasEnded('2026-01-01', '2025-12-31')).toBe(false);
  });

  it('compares across a month boundary', () => {
    expect(hasEnded('2026-08-31', '2026-09-01')).toBe(true);
    expect(hasEnded('2026-09-01', '2026-08-31')).toBe(false);
  });
});

describe('the refusal', () => {
  // Both ends render this string. If it drifts, the panel and the server explain the
  // same rule in two voices, which is the failure invariant 1 exists to prevent.
  it('names the rule rather than only denying', () => {
    expect(ENDED_REFUSAL).toContain('part of the record');
    expect(ENDED_REFUSAL).toContain('cannot be changed');
  });
});
