import { describe, it, expect } from 'vitest';
import { fingerprint, differences, VESSELS_KEY } from './fingerprint';
import type { Stay } from './fingerprint';

const stay = (label: string, start: string, end = start, berth = 'North Pier East'): Stay =>
  ({ berth, kind: 'vessel', status: 'active', label, start, end });

const base = [
  stay('Barge Silver Voyager', '2015-03-14'),
  stay('F/V Bright Ketch', '2015-03-18'),
  stay('R/V Long Ketch', '2015-06-01', '2015-06-04'),
];
const register = [{ name: 'R/V LONG KETCH', lengthFt: null }];

describe('fingerprint', () => {
  it('is the same for the same schedule, whatever order the rows arrive in', () => {
    expect(fingerprint(base, register)).toEqual(fingerprint([...base].reverse(), register));
  });

  it('sees two bookings swap dates, which no total can', () => {
    // The case that made /check call a different schedule identical.
    const swapped = [
      stay('F/V Bright Ketch', '2015-03-14'),
      stay('Barge Silver Voyager', '2015-03-18'),
      base[2],
    ];
    expect(differences(fingerprint(base, register), fingerprint(swapped, register))).toEqual(['2015-03']);
  });

  it('says which month moved, both where a stay left and where it arrived', () => {
    const moved = [base[0], base[1], stay('R/V Long Ketch', '2015-07-01', '2015-07-04')];
    expect(differences(fingerprint(base, register), fingerprint(moved, register))).toEqual(['2015-06', '2015-07']);
  });

  it('sees a changed berth, status or length', () => {
    const a = fingerprint(base, register);
    expect(differences(a, fingerprint([{ ...base[0], berth: 'Inner Channel' }, base[1], base[2]], register))).toEqual(['2015-03']);
    expect(differences(a, fingerprint([{ ...base[0], status: 'conflict_unresolved' }, base[1], base[2]], register))).toEqual(['2015-03']);
    expect(differences(a, fingerprint(base, [{ name: 'R/V LONG KETCH', lengthFt: 64 }]))).toEqual([VESSELS_KEY]);
  });
});
