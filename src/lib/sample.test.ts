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

  it('never end before they start, and stay inside a window the board can reach', () => {
    for (const b of SAMPLE_BOOKINGS) {
      expect(b.to, b.label).toBeGreaterThanOrEqual(b.from);
      // lib/nav reaches a year back and three years forward, so nothing here can be
      // stored and then be impossible to navigate to.
      expect(b.from, b.label).toBeGreaterThan(-300);
      expect(b.to, b.label).toBeLessThan(300);
    }
  });

  it('puts a past behind the load day, not only a future ahead of it', () => {
    // A board that is blank until today and busy after it reads as a system switched
    // on this morning. A dock that has been running has history on the same screen.
    expect(SAMPLE_BOOKINGS.some((b) => b.to < 0)).toBe(true);
    expect(SAMPLE_BOOKINGS.some((b) => b.from > 0)).toBe(true);
    // ...and one stay straddling today, so "now" always sits inside a booking.
    expect(SAMPLE_BOOKINGS.some((b) => b.from <= 0 && b.to >= 0)).toBe(true);
  });

  it('covers every berth, so no lane is empty on the day it is loaded', () => {
    const berths = new Set(SAMPLE_BOOKINGS.map((b) => b.berth));
    expect(berths.size).toBe(7);
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
    // By offset, not by name: OSV AMBER REEF is booked twice, once behind the load
    // day and once ahead of it. This is the forward stay, which crosses a month end.
    const reef = dateSampleBookings(TODAY).find((b) => b.label === 'OSV AMBER REEF' && b.from === 4)!;
    expect(reef.start).toBe('2026-09-24');
    expect(reef.end).toBe('2026-10-02');
  });
});
