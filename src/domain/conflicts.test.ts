import { describe, it, expect } from 'vitest';
import { overlaps, findConflicts, rangeLengthDays, isValidRange, isBookable } from './conflicts';
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

describe('isBookable', () => {
  it('is false when a conflict exists', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-11', end: '2010-07-11' } }, [booking()], exclusive)).toBe(false);
  });
  it('is false for an invalid range even with no conflicts', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-20', end: '2010-07-01' } }, [], exclusive)).toBe(false);
  });
  it('is true on a clear berth with a valid range', () => {
    expect(isBookable({ berthId: 'sfe', range: { start: '2010-07-20', end: '2010-07-22' } }, [booking()], exclusive)).toBe(true);
  });
});
