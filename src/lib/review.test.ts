import { describe, it, expect } from 'vitest';
import { groupReviewItems, describeOccurrences } from './review';
import type { Groupable } from './review';

// Spread rather than `??` for the defaults: passing an explicit null must mean null,
// not "use the default".
const BASE: Groupable = {
  id: 'r1',
  type: 'too_long',
  rawText: 'M/V Iron Heron',
  detail: "Vessel is 100' but the berth is 55'",
  vesselId: 'v1',
  berthName: 'Inner Channel',
  bookingStart: '2006-02-04',
  importSheet: '2006',
  importRow: 22,
  importCol: 5,
};

function row(over: Partial<Groupable> = {}): Groupable {
  return { ...BASE, ...over };
}

describe('groupReviewItems', () => {
  it('folds one vessel too long for one berth into a single group', () => {
    const groups = groupReviewItems([
      row({ id: 'a', bookingStart: '2006-02-04' }),
      row({ id: 'b', bookingStart: '2006-03-13' }),
      row({ id: 'c', bookingStart: '2006-09-15' }),
      row({ id: 'd', bookingStart: '2006-10-20' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['a', 'b', 'c', 'd']);
  });

  // The same hull can fit one berth and not another, so the berth is part of the key.
  it('keeps one vessel apart when the berth differs', () => {
    const groups = groupReviewItems([
      row({ id: 'a', berthName: 'Inner Channel' }),
      row({ id: 'b', berthName: 'South Float East' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('folds an unreadable cell by its text, however it is cased', () => {
    const groups = groupReviewItems([
      row({ id: 'a', type: 'unclassified', rawText: 'Ultrasonic pier test', vesselId: null }),
      row({ id: 'b', type: 'unclassified', rawText: 'ULTRASONIC PIER TEST', vesselId: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toHaveLength(2);
  });

  // Each conflict is a distinct pair of bookings needing its own resolution.
  it('never groups conflicts, even on the same berth', () => {
    const groups = groupReviewItems([
      row({ id: 'a', type: 'conflict', berthName: 'South Float East' }),
      row({ id: 'b', type: 'conflict', berthName: 'South Float East' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('orders occurrences within a group by date', () => {
    const groups = groupReviewItems([
      row({ id: 'late', bookingStart: '2006-10-20' }),
      row({ id: 'early', bookingStart: '2006-02-04' }),
    ]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('returns nothing for no rows', () => {
    expect(groupReviewItems([])).toEqual([]);
  });
});

describe('describeOccurrences', () => {
  it('names the single date when there is one', () => {
    const [g] = groupReviewItems([row({ bookingStart: '2009-06-30' })]);
    expect(describeOccurrences(g)).toBe('2009-06-30');
  });
  it('spans first to last when there are several', () => {
    const [g] = groupReviewItems([
      row({ id: 'a', bookingStart: '2006-02-04' }),
      row({ id: 'b', bookingStart: '2006-10-20' }),
    ]);
    expect(describeOccurrences(g)).toBe('2 bookings, 2006-02-04 to 2006-10-20');
  });
  it('says nothing when no occurrence has a date', () => {
    const [g] = groupReviewItems([row({ type: 'unclassified', bookingStart: null, vesselId: null })]);
    expect(describeOccurrences(g)).toBeNull();
  });
});
