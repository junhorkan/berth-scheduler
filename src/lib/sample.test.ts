import { describe, it, expect } from 'vitest';
import { SAMPLE_BOOKINGS, dateSampleBookings, addDays } from './sample';
import { overlaps } from '../domain/conflicts';
import { capacityModeFor } from '../domain/normalize';

const TODAY = '2026-09-20';

describe('the sample bookings in the coming weeks', () => {
  it('never overlap on an exclusive berth, or the database would refuse the whole reload', () => {
    const dated = dateSampleBookings(TODAY);
    for (const a of dated) {
      for (const b of dated) {
        if (a === b || a.berth !== b.berth) continue;
        if (capacityModeFor(a.berth) === 'pooled') continue;
        expect(
          overlaps({ start: a.start, end: a.end }, { start: b.start, end: b.end }),
          `${a.label} (${a.start}..${a.end}) against ${b.label} (${b.start}..${b.end})`,
        ).toBe(false);
      }
    }
  });

  it('start on or after the load day, and end on or after they start', () => {
    for (const b of SAMPLE_BOOKINGS) {
      expect(b.from, b.label).toBeGreaterThanOrEqual(0);
      expect(b.to, b.label).toBeGreaterThanOrEqual(b.from);
    }
  });

  it('take the berth the form opens onto, on the day it opens to', () => {
    // North Pier West is first in display order and today is the form's default date,
    // so the very first verdict a visitor sees is the refusal.
    expect(SAMPLE_BOOKINGS.some((b) => b.berth === 'North Pier West' && b.from === 0)).toBe(true);
  });

  it('put two boats in the pooled slips at the same time', () => {
    const pooled = dateSampleBookings(TODAY).filter((b) => capacityModeFor(b.berth) === 'pooled');
    expect(pooled.length).toBeGreaterThanOrEqual(2);
    const [a, b] = pooled;
    expect(overlaps({ start: a.start, end: a.end }, { start: b.start, end: b.end })).toBe(true);
  });

  it('cover a vessel, an event and a closure', () => {
    const kinds = new Set(SAMPLE_BOOKINGS.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(['closure', 'event', 'vessel']);
  });

  it('resolve offsets across a month end and a year end without drifting', () => {
    expect(addDays(TODAY, 12)).toBe('2026-10-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    const reef = dateSampleBookings(TODAY).find((b) => b.label === 'OSV AMBER REEF')!;
    expect(reef.start).toBe('2026-09-24');
    expect(reef.end).toBe('2026-10-02');
  });
});
