import { describe, it, expect } from 'vitest';
import {
  overlaps, findConflicts, rangeLengthDays, isValidRange, isBookable, sharedRange,
  findVesselClashes,
} from './conflicts';
import type { Booking, Berth } from './types';

const exclusive: Pick<Berth, 'id' | 'capacityMode'> = { id: 'sfe', capacityMode: 'exclusive' };
const pooled: Pick<Berth, 'id' | 'capacityMode'> = { id: 'slips', capacityMode: 'pooled' };

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    berthId: 'sfe',
    vesselId: 'v1',
    kind: 'vessel',
    status: 'active',
    label: 'R/V Long Ketch',
    range: { start: '2010-07-10', end: '2010-07-12' },
    ...over,
  };
}

describe('overlaps — inclusive-end semantics', () => {
  it('flags ranges that share a single day (Mon-Wed vs Wed-Fri)', () => {
    // Both need the berth on Wednesday. This IS a conflict.
    expect(overlaps({ start: '2010-07-12', end: '2010-07-14' }, { start: '2010-07-14', end: '2010-07-16' })).toBe(true);
  });

  it('does NOT flag merely adjacent ranges (Mon-Tue vs Wed-Thu)', () => {
    expect(overlaps({ start: '2010-07-12', end: '2010-07-13' }, { start: '2010-07-14', end: '2010-07-15' })).toBe(false);
  });

  it('flags full containment in both directions', () => {
    const outer = { start: '2010-07-01', end: '2010-07-31' };
    const inner = { start: '2010-07-10', end: '2010-07-11' };
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it('flags identical single-day ranges', () => {
    expect(overlaps({ start: '2010-07-13', end: '2010-07-13' }, { start: '2010-07-13', end: '2010-07-13' })).toBe(true);
  });

  it('is symmetric', () => {
    const a = { start: '2010-07-05', end: '2010-07-09' };
    const b = { start: '2010-07-08', end: '2010-07-20' };
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it('handles ranges crossing a month boundary', () => {
    // 277 source entries end on day >= 28, so this path is heavily exercised.
    expect(overlaps({ start: '2010-07-28', end: '2010-08-03' }, { start: '2010-08-01', end: '2010-08-02' })).toBe(true);
  });

  it('handles ranges crossing a year boundary', () => {
    expect(overlaps({ start: '2010-12-28', end: '2011-01-04' }, { start: '2011-01-01', end: '2011-01-02' })).toBe(true);
  });
});

describe('rangeLengthDays', () => {
  it('counts inclusively — Jul 13 to Jul 16 is 4 days', () => {
    expect(rangeLengthDays({ start: '2010-07-13', end: '2010-07-16' })).toBe(4);
  });

  it('counts a single day as 1', () => {
    expect(rangeLengthDays({ start: '2010-07-13', end: '2010-07-13' })).toBe(1);
  });

  it('counts across a month boundary', () => {
    expect(rangeLengthDays({ start: '2010-07-30', end: '2010-08-02' })).toBe(4);
  });
});

describe('isValidRange', () => {
  it('rejects an end before the start', () => {
    expect(isValidRange({ start: '2010-07-16', end: '2010-07-13' })).toBe(false);
  });
  it('accepts a single day', () => {
    expect(isValidRange({ start: '2010-07-13', end: '2010-07-13' })).toBe(true);
  });
  it('rejects malformed dates', () => {
    expect(isValidRange({ start: '13/07/2010', end: '16/07/2010' })).toBe(false);
  });
});

describe('findConflicts', () => {
  it('finds an overlapping active booking on the same exclusive berth', () => {
    const existing = [booking({ id: 'existing' })];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-11', end: '2010-07-13' } };
    expect(findConflicts(candidate, existing, exclusive).map((b) => b.id)).toEqual(['existing']);
  });

  it('ignores bookings on a different berth', () => {
    const existing = [booking({ id: 'other', berthId: 'npw' })];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-11', end: '2010-07-13' } };
    expect(findConflicts(candidate, existing, exclusive)).toEqual([]);
  });

  it('returns nothing for a POOLED berth even when dates overlap exactly', () => {
    // "Small craft slips" holds several institution boats at once.
    const existing = [booking({ id: 'boatA', berthId: 'slips' })];
    const candidate = { berthId: 'slips', range: { start: '2010-07-10', end: '2010-07-12' } };
    expect(findConflicts(candidate, existing, pooled)).toEqual([]);
  });

  it('ignores cancelled bookings — cancelling frees the berth', () => {
    const existing = [booking({ id: 'gone', status: 'cancelled' })];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-12' } };
    expect(findConflicts(candidate, existing, exclusive)).toEqual([]);
  });

  it('does not cascade off an imported conflict_unresolved row', () => {
    // Historical overlaps are flagged, not active, and must not spread conflicts.
    const existing = [booking({ id: 'legacy', status: 'conflict_unresolved' })];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-12' } };
    expect(findConflicts(candidate, existing, exclusive)).toEqual([]);
  });

  it('excludes the candidate itself, so editing a booking does not fight itself', () => {
    const self = booking({ id: 'same' });
    const candidate = { id: 'same', berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-14' } };
    expect(findConflicts(candidate, [self], exclusive)).toEqual([]);
  });

  it('reports every collision, not just the first', () => {
    const existing = [
      booking({ id: 'a', range: { start: '2010-07-01', end: '2010-07-11' } }),
      booking({ id: 'b', range: { start: '2010-07-12', end: '2010-07-20' } }),
    ];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-13' } };
    expect(findConflicts(candidate, existing, exclusive).map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('treats a closure as blocking a vessel', () => {
    // Booking into a closed berth is a real third conflict class.
    const existing = [booking({ id: 'closed', kind: 'closure', vesselId: null, label: 'Float rebuild - no usage permitted' })];
    const candidate = { berthId: 'sfe', range: { start: '2010-07-11', end: '2010-07-11' } };
    expect(findConflicts(candidate, existing, exclusive).map((b) => b.id)).toEqual(['closed']);
  });
});

describe('sharedRange', () => {
  it('is the later start and the earlier end', () => {
    expect(sharedRange({ start: '2010-07-10', end: '2010-07-20' }, { start: '2010-07-15', end: '2010-07-25' }))
      .toEqual({ start: '2010-07-15', end: '2010-07-20' });
  });

  it('is the inner range when one contains the other', () => {
    expect(sharedRange({ start: '2010-07-01', end: '2010-07-31' }, { start: '2010-07-10', end: '2010-07-11' }))
      .toEqual({ start: '2010-07-10', end: '2010-07-11' });
  });

  it('is null for merely adjacent ranges', () => {
    expect(sharedRange({ start: '2010-07-10', end: '2010-07-11' }, { start: '2010-07-12', end: '2010-07-13' }))
      .toBeNull();
  });
});

describe('findVesselClashes — one hull, two berths', () => {
  // The candidate is the same vessel as the fixture's default, at a DIFFERENT berth.
  const elsewhere = { vesselId: 'v1', berthId: 'npw', range: { start: '2010-07-10', end: '2010-07-12' } };

  it('reports nothing when the dates do not meet', () => {
    const existing = [booking({ id: 'a', range: { start: '2010-07-20', end: '2010-07-22' } })];
    expect(findVesselClashes(elsewhere, existing)).toEqual([]);
  });

  it('reports a single shared day, and counts it as 1', () => {
    // The eight-of-twelve case in the source schedule: plausibly a berth shift that day,
    // which is why the count is returned rather than just the fact of an overlap.
    const existing = [booking({ id: 'shift', range: { start: '2010-07-12', end: '2010-07-15' } })];
    const found = findVesselClashes(elsewhere, existing);
    expect(found.map((c) => c.booking.id)).toEqual(['shift']);
    expect(found[0].sharedDays).toBe(1);
    expect(found[0].shared).toEqual({ start: '2010-07-12', end: '2010-07-12' });
  });

  it('counts a two-day overlap, which no berth shift explains', () => {
    // The four-of-twelve case: one hull in two places for two whole days.
    const existing = [booking({ id: 'real', range: { start: '2010-07-11', end: '2010-07-14' } })];
    const found = findVesselClashes(elsewhere, existing);
    expect(found[0].sharedDays).toBe(2);
    expect(found[0].shared).toEqual({ start: '2010-07-11', end: '2010-07-12' });
  });

  it('does NOT report the same berth — that is the hard conflict, red and unstorable', () => {
    const existing = [booking({ id: 'same-berth', berthId: 'sfe' })];
    const candidate = { vesselId: 'v1', berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-12' } };
    expect(findVesselClashes(candidate, existing)).toEqual([]);
    // ...and the hard check does report it, so nothing goes unsaid.
    expect(findConflicts(candidate, existing, exclusive).map((b) => b.id)).toEqual(['same-berth']);
  });

  it('ignores a cancelled booking — the hull is not there', () => {
    const existing = [booking({ id: 'gone', berthId: 'sfe', status: 'cancelled' })];
    expect(findVesselClashes(elsewhere, existing)).toEqual([]);
  });

  it('ignores an imported conflict_unresolved row for the same reason findConflicts does', () => {
    const existing = [booking({ id: 'legacy', status: 'conflict_unresolved' })];
    expect(findVesselClashes(elsewhere, existing)).toEqual([]);
  });

  it('ignores a booking with no vessel — a closure is not a hull in two places', () => {
    const existing = [booking({ id: 'closed', kind: 'closure', vesselId: null, label: 'Float rebuild' })];
    expect(findVesselClashes(elsewhere, existing)).toEqual([]);
  });

  it('reports nothing for a candidate with no vessel, however the dates fall', () => {
    const existing = [booking({ id: 'a' })];
    expect(findVesselClashes({ vesselId: null, berthId: 'npw', range: { start: '2010-07-10', end: '2010-07-12' } }, existing))
      .toEqual([]);
  });

  it('ignores a different hull on another berth', () => {
    const existing = [booking({ id: 'other-hull', vesselId: 'v2' })];
    expect(findVesselClashes(elsewhere, existing)).toEqual([]);
  });

  it('honours excludeBookingId, so moving a booking does not clash with itself', () => {
    // Moving 'self' from sfe to npw: the row being moved is still in the table.
    const self = booking({ id: 'self' });
    const candidate = { id: 'self', vesselId: 'v1', berthId: 'npw', range: { start: '2010-07-10', end: '2010-07-12' } };
    expect(findVesselClashes(candidate, [self])).toEqual([]);
  });

  it('does not exempt a pooled berth — one hull cannot also be in the slips', () => {
    const existing = [booking({ id: 'slip', berthId: 'slips' })];
    expect(findVesselClashes(elsewhere, existing).map((c) => c.booking.id)).toEqual(['slip']);
  });

  it('reports every clash, each with its own day count', () => {
    const existing = [
      booking({ id: 'a', berthId: 'npe', range: { start: '2010-07-12', end: '2010-07-20' } }),
      booking({ id: 'b', berthId: 'slips', range: { start: '2010-07-09', end: '2010-07-11' } }),
    ];
    expect(findVesselClashes(elsewhere, existing).map((c) => [c.booking.id, c.sharedDays]))
      .toEqual([['a', 1], ['b', 2]]);
  });
});

describe('isBookable', () => {
  it('is false when a conflict exists', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-11', end: '2010-07-11' } }, [booking()], exclusive)).toBe(false);
  });
  it('is false for an invalid range even with no conflicts', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-20', end: '2010-07-01' } }, [], exclusive)).toBe(false);
  });
  it('is true when the same hull is booked at ANOTHER berth over the same days', () => {
    // The clash is advisory. Nothing about it may reach the gate on Save (DECISIONS 2).
    const existing = [booking({ id: 'elsewhere', berthId: 'npw' })];
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-10', end: '2010-07-12' } }, existing, exclusive)).toBe(true);
  });
  it('is true on a clear berth with a valid range', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-20', end: '2010-07-22' } }, [booking()], exclusive)).toBe(true);
  });
});
