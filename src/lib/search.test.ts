import { describe, it, expect } from 'vitest';
import {
  normalizeQuery, isSearchable, escapeLike, likePattern, groupHits, MIN_QUERY_LENGTH,
  formatSpan, formatSpanFull, hitHref,
} from './search';
import type { SearchHit } from './search';

function hit(over: Partial<SearchHit> = {}): SearchHit {
  return {
    id: over.id ?? 'b1',
    label: over.label ?? 'R/V Long Ketch',
    vesselId: over.vesselId ?? 'v1',
    vesselName: over.vesselName ?? 'R/V Long Ketch',
    kind: over.kind ?? 'vessel',
    status: over.status ?? 'active',
    startDate: over.startDate ?? '2010-07-06',
    endDate: over.endDate ?? '2010-07-19',
    berthName: over.berthName ?? 'North Pier West',
  };
}

describe('normalizeQuery', () => {
  it('collapses surrounding and internal whitespace', () => {
    expect(normalizeQuery('  long   ketch ')).toBe('long ketch');
  });
});

describe('isSearchable', () => {
  it('rejects a query shorter than the minimum after trimming', () => {
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('')).toBe(false);
  });
  it('accepts a query at the minimum length', () => {
    expect(isSearchable('os')).toBe(true);
    expect('os'.length).toBe(MIN_QUERY_LENGTH);
  });
});

describe('escapeLike', () => {
  // Without escaping, '100%' matches the entire schedule and '_' matches any character.
  it('neutralizes LIKE wildcards the user typed as text', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
  });
  it('escapes backslash so a literal backslash stays literal', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
  it('leaves ordinary punctuation in vessel names alone', () => {
    expect(escapeLike('OS/V AMBER REEF')).toBe('OS/V AMBER REEF');
  });
});

describe('likePattern', () => {
  it('wraps a normalized, escaped query in contains-match wildcards', () => {
    expect(likePattern('  long   ketch ')).toBe('%long ketch%');
    expect(likePattern('50%')).toBe('%50\\%%');
  });
});

describe('groupHits', () => {
  it('collapses many bookings of one vessel into a single group', () => {
    const groups = groupHits(
      [
        hit({ id: 'a', startDate: '2010-07-06' }),
        hit({ id: 'b', startDate: '2010-06-02' }),
        hit({ id: 'c', startDate: '1999-04-08' }),
      ],
      'long ketch',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bookingCount).toBe(3);
    expect(groups[0].firstYear).toBe(1999);
    expect(groups[0].lastYear).toBe(2010);
  });

  it('orders bookings within a group most recent first', () => {
    const groups = groupHits(
      [
        hit({ id: 'old', startDate: '1999-04-08' }),
        hit({ id: 'new', startDate: '2010-07-06' }),
        hit({ id: 'mid', startDate: '2005-01-02' }),
      ],
      'long',
    );
    expect(groups[0].hits.map((h) => h.id)).toEqual(['new', 'mid', 'old']);
  });

  it('groups events by label, since they have no vessel row', () => {
    const groups = groupHits(
      [
        hit({ id: 'e1', vesselId: null, vesselName: null, kind: 'event', label: 'Community sail day' }),
        hit({ id: 'e2', vesselId: null, vesselName: null, kind: 'event', label: 'Community Sail Day' }),
      ],
      'sail',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bookingCount).toBe(2);
  });

  it('keeps two different vessels apart even when their names both match', () => {
    const groups = groupHits(
      [
        hit({ id: 'a', vesselId: 'v1', vesselName: 'R/V Long Ketch' }),
        hit({ id: 'b', vesselId: 'v2', vesselName: 'R/V Long Reach' }),
      ],
      'long',
    );
    expect(groups).toHaveLength(2);
  });

  // The vessel whose name STARTS with the query is the one meant, even when another
  // identity matching mid-string has far more bookings.
  it('ranks a prefix match above a busier mid-string match', () => {
    const rows = [
      hit({ id: 'x', vesselId: 'v2', vesselName: 'Barge Salt Dory' }),
      hit({ id: 'y', vesselId: 'v2', vesselName: 'Barge Salt Dory', startDate: '2011-01-01' }),
      hit({ id: 'z', vesselId: 'v1', vesselName: 'Salt Marsh Skiff' }),
    ];
    const groups = groupHits(rows, 'salt');
    expect(groups[0].name).toBe('Salt Marsh Skiff');
    expect(groups[1].bookingCount).toBe(2);
  });

  it('falls back to booking count when neither name is a prefix match', () => {
    const groups = groupHits(
      [
        hit({ id: 'a', vesselId: 'v1', vesselName: 'R/V Long Ketch' }),
        hit({ id: 'b', vesselId: 'v1', vesselName: 'R/V Long Ketch', startDate: '2011-01-01' }),
        hit({ id: 'c', vesselId: 'v2', vesselName: 'M/V Long Haul' }),
      ],
      'long',
    );
    expect(groups.map((g) => g.name)).toEqual(['R/V Long Ketch', 'M/V Long Haul']);
  });

  it('returns nothing for no rows rather than throwing', () => {
    expect(groupHits([], 'nothing')).toEqual([]);
  });
});

describe('formatSpan', () => {
  it('shows a single day once, not as a range', () => {
    expect(formatSpan('2010-07-06', '2010-07-06')).toBe('Jul 6');
  });
  it('omits the repeated month within one month', () => {
    expect(formatSpan('2010-07-06', '2010-07-19')).toBe('Jul 6 – 19');
  });
  it('names both months when the stay crosses a boundary', () => {
    expect(formatSpan('2010-06-28', '2010-07-03')).toBe('Jun 28 – Jul 3');
  });
  it('names both months across a year boundary', () => {
    expect(formatSpan('2004-12-28', '2005-01-04')).toBe('Dec 28 – Jan 4');
  });
  // new Date('2010-07-06') is UTC midnight, which is July 5 in any western timezone.
  it('reads the date from the string, so it never shifts by timezone', () => {
    expect(formatSpan('2010-01-01', '2010-01-01')).toBe('Jan 1');
    expect(formatSpan('2010-12-31', '2010-12-31')).toBe('Dec 31');
  });
});

/*
  Review spans 23 years with nothing beside a row to say which one, so it needs the
  year that /search leaves to its own column. A sibling rather than a change to
  formatSpan: the search table and the berth suggester both read the shorter form.
*/
describe('formatSpanFull', () => {
  it('states the year on a single day', () => {
    expect(formatSpanFull('2017-07-11', '2017-07-11')).toBe('Jul 11 2017');
  });
  it('states the year once within one month', () => {
    expect(formatSpanFull('2010-07-06', '2010-07-19')).toBe('Jul 6 – 19 2010');
  });
  it('states the year once across a month boundary', () => {
    expect(formatSpanFull('2010-06-28', '2010-07-03')).toBe('Jun 28 – Jul 3 2010');
  });
  // The one case a single trailing year would get wrong.
  it('states both years across a year boundary', () => {
    expect(formatSpanFull('2004-12-28', '2005-01-04')).toBe('Dec 28 2004 – Jan 4 2005');
  });
  it('keeps a leap day, reading the string rather than a Date', () => {
    expect(formatSpanFull('2004-02-29', '2004-02-29')).toBe('Feb 29 2004');
    expect(formatSpanFull('2004-02-27', '2004-02-29')).toBe('Feb 27 – 29 2004');
  });
  // The whole point: no row on Review may read as an ISO date.
  it('never reproduces the ISO form', () => {
    for (const [a, b] of [
      ['1997-08-01', '1997-08-01'],
      ['2006-02-04', '2006-10-20'],
      ['2019-12-31', '2020-01-01'],
    ]) {
      expect(formatSpanFull(a, b)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('hitHref', () => {
  it('links to the booking’s own month with it selected', () => {
    expect(hitHref(hit({ id: 'abc', startDate: '2010-07-06' })))
      .toBe('/?y=2010&m=7&sel=abc');
  });
  it('does not zero-pad the month, matching the board’s own links', () => {
    expect(hitHref(hit({ id: 'abc', startDate: '1997-08-01' })))
      .toBe('/?y=1997&m=8&sel=abc');
  });
});
