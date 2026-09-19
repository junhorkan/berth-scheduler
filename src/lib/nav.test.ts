import { describe, it, expect } from 'vitest';
import { clampMonth, step, DEFAULT_YEAR, DEFAULT_MONTH } from './nav';

describe('clampMonth', () => {
  it('rolls month 0 back into the previous December', () => {
    expect(clampMonth(2010, 0)).toEqual({ year: 2009, month: 12 });
  });
  it('rolls month 13 forward into the next January', () => {
    expect(clampMonth(2010, 13)).toEqual({ year: 2011, month: 1 });
  });
  it('stops at the start of the data, which is August 1997', () => {
    expect(clampMonth(1997, 1)).toEqual({ year: 1997, month: 8 });
    expect(clampMonth(1990, 5)).toEqual({ year: 1997, month: 8 });
  });
  it('stops at the end of the data', () => {
    expect(clampMonth(2030, 5)).toEqual({ year: 2019, month: 12 });
  });
  it('falls back to the default month on garbage input', () => {
    expect(clampMonth(NaN, NaN)).toEqual({ year: DEFAULT_YEAR, month: DEFAULT_MONTH });
  });
});

describe('step', () => {
  it('walks forward across a year boundary', () => {
    expect(step(2010, 12, 1)).toEqual({ year: 2011, month: 1 });
  });
  it('walks backward across a year boundary', () => {
    expect(step(2011, 1, -1)).toEqual({ year: 2010, month: 12 });
  });
  it('cannot walk past the last month of data', () => {
    expect(step(2019, 12, 1)).toEqual({ year: 2019, month: 12 });
  });
  it('cannot walk before the first month of data', () => {
    expect(step(1997, 8, -1)).toEqual({ year: 1997, month: 8 });
  });
});
