import { describe, it, expect } from 'vitest';
import { groupReviewItems, describeOccurrences, tighten } from './review';
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
  // A row carries a start and no end, so one occurrence is one date and not a span.
  it('names the single date when there is one', () => {
    const [g] = groupReviewItems([row({ bookingStart: '2009-06-30' })]);
    expect(describeOccurrences(g)).toBe('Jun 30 2009');
  });
  it('spans first to last when there are several', () => {
    const [g] = groupReviewItems([
      row({ id: 'a', bookingStart: '2006-02-04' }),
      row({ id: 'b', bookingStart: '2006-10-20' }),
    ]);
    expect(describeOccurrences(g)).toBe('2 bookings, Feb 4 – Oct 20 2006');
  });
  it('names both years when the occurrences cross one', () => {
    const [g] = groupReviewItems([
      row({ id: 'a', bookingStart: '2006-12-28' }),
      row({ id: 'b', bookingStart: '2007-01-04' }),
    ]);
    expect(describeOccurrences(g)).toBe('2 bookings, Dec 28 2006 – Jan 4 2007');
  });
  it('says nothing when no occurrence has a date', () => {
    const [g] = groupReviewItems([row({ type: 'unclassified', bookingStart: null, vesselId: null })]);
    expect(describeOccurrences(g)).toBeNull();
  });
  // Review was the last page in the product showing a date the way Postgres stores it.
  it('never reads back an ISO date', () => {
    const [g] = groupReviewItems([row({ bookingStart: '2017-07-11' })]);
    expect(describeOccurrences(g)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

/*
  Regex on prose, so every branch is pinned: what it rewrites, and — more important —
  what it must leave alone.
*/
describe('tighten', () => {
  it('drops the trailing span the meta line already states', () => {
    expect(tighten('Vessel is 100ft but the berth is 55ft — over by 45ft. (2006-02-04..2006-02-04)'))
      .toBe('Vessel is 100ft but the berth is 55ft — over by 45ft.');
  });

  it('spells feet the way the app does', () => {
    expect(tighten("Vessel is 100' but the berth is 55'"))
      .toBe('Vessel is 100ft but the berth is 55ft');
  });

  // The reason the rule is anchored to a digit.
  it("leaves an apostrophe inside a vessel's name alone", () => {
    expect(tighten("S/Y O'Hara is 100' but the berth is 55'"))
      .toBe("S/Y O'Hara is 100ft but the berth is 55ft");
    expect(tighten("Overlaps M/V Cap'n Bill")).toBe("Overlaps M/V Cap'n Bill");
  });

  it("writes a conflict's leading span the way the rest of the site would", () => {
    expect(tighten('2017-07-11..2017-07-11 on South Float East overlaps OSV AMBER REEF'))
      .toBe('Jul 11 2017 on South Float East overlaps OSV AMBER REEF');
    expect(tighten('2010-07-29..2010-08-01 on North Pier Face overlaps R/V CLEAR TERN'))
      .toBe('Jul 29 – Aug 1 2010 on North Pier Face overlaps R/V CLEAR TERN');
  });

  // A leading span and a trailing one in the same sentence: the partner's bracketed
  // span goes, this booking's span is rewritten in place.
  it('handles both spans in one sentence', () => {
    expect(tighten('2004-12-28..2005-01-04 on Inner Channel overlaps M/V TEST (2005-01-02..2005-01-06)'))
      .toBe('Dec 28 2004 – Jan 4 2005 on Inner Channel overlaps M/V TEST');
  });

  // The importer read a cell, not a stay: a year-month and a day number.
  it('turns an unreadable cell’s year-month and day into one date', () => {
    expect(tighten('In North Pier West, 2001-06 day 16'))
      .toBe('In North Pier West, Jun 16 2001');
    expect(tighten('In South Float West, 2008-03 day 1'))
      .toBe('In South Float West, Mar 1 2008');
  });

  it('leaves a sentence with no dates in it untouched', () => {
    const as_is = 'Found on a day-number row with no berth, so it cannot be attributed';
    expect(tighten(as_is)).toBe(as_is);
  });

  // A span anywhere but the front is not this rule's business — only the prefix the
  // importer writes is rewritten, so a stray one is left rather than half-translated.
  it('only rewrites the span it is sure of', () => {
    expect(tighten('Overlaps a booking 2006-02-04..2006-10-20 elsewhere'))
      .toBe('Overlaps a booking 2006-02-04..2006-10-20 elsewhere');
  });
});
