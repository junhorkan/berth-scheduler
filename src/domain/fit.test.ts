import { describe, it, expect } from 'vitest';
import { checkFit, barHeightRatio, fitForBooking } from './fit';

describe('checkFit', () => {
  it('returns unverified when the vessel length is unknown', () => {
    // This is the 97.5% case in the real data. It must never read as "fits".
    const r = checkFit(null, 90);
    expect(r.verdict).toBe('unverified');
    expect(r.overByFt).toBeUndefined();
  });

  it('returns unverified when the berth length is unknown', () => {
    expect(checkFit(40, null).verdict).toBe('unverified');
  });

  it('returns fits when the vessel is shorter than the berth', () => {
    expect(checkFit(40, 90).verdict).toBe('fits');
  });

  it('returns fits when the vessel exactly equals the berth', () => {
    // 90' in a 90' berth is a fit, not a violation.
    expect(checkFit(90, 90).verdict).toBe('fits');
  });

  it('returns too_long one foot over', () => {
    const r = checkFit(91, 90);
    expect(r.verdict).toBe('too_long');
    expect(r.overByFt).toBe(1);
  });

  describe('real violations found in the source workbook', () => {
    it('M/Y Wild Tern 145ft in South Float East 90ft — over by 55', () => {
      const r = checkFit(145, 90);
      expect(r.verdict).toBe('too_long');
      expect(r.overByFt).toBe(55);
    });

    it('S/Y Clear Beacon 170ft in South Float East 90ft — over by 80', () => {
      expect(checkFit(170, 90).overByFt).toBe(80);
    });

    it('R/V Clear Tern 120ft in North Pier Face 75ft — over by 45', () => {
      expect(checkFit(120, 75).overByFt).toBe(45);
    });

    it('M/V Iron Heron 100ft in Inner Channel 55ft — over by 45', () => {
      expect(checkFit(100, 55).overByFt).toBe(45);
    });

    it('S/Y High Gannet 100ft in South Float East 90ft — over by 10', () => {
      expect(checkFit(100, 90).overByFt).toBe(10);
    });
  });

  it('includes both lengths in the reason text so the panel can show it verbatim', () => {
    expect(checkFit(145, 90).reason).toContain("145'");
    expect(checkFit(145, 90).reason).toContain("90'");
  });
});

describe('barHeightRatio — the bar geometry IS the fit check', () => {
  it('gives a ratio above 1 when the vessel exceeds the berth, so the bar overflows its lane', () => {
    expect(barHeightRatio(145, 90)).toBeCloseTo(1.611, 3);
  });

  it('gives a ratio below 1 for a vessel that fits', () => {
    expect(barHeightRatio(40, 90)).toBeCloseTo(0.444, 3);
  });

  it('gives exactly 1 when vessel and berth match', () => {
    expect(barHeightRatio(90, 90)).toBe(1);
  });

  it('uses a fixed modest height for unknown lengths, implying no size we do not know', () => {
    expect(barHeightRatio(null, 90)).toBe(0.55);
    expect(barHeightRatio(120, null)).toBe(0.55);
  });

  it('does not divide by zero on a zero-length berth', () => {
    expect(barHeightRatio(120, 0)).toBe(0.55);
  });
});

describe('fitForBooking', () => {
  it('is not_applicable for a non-vessel event, distinct from unverified', () => {
    // A Community sail day has no vessel; "we cannot verify" would be wrong.
    expect(fitForBooking({ kind: 'event' }, null, { lengthFt: 75 })).toBe('not_applicable');
  });

  it('is not_applicable for a closure', () => {
    expect(fitForBooking({ kind: 'closure' }, null, { lengthFt: 90 })).toBe('not_applicable');
  });

  it('evaluates fit for a vessel booking', () => {
    const r = fitForBooking({ kind: 'vessel' }, { lengthFt: 145 }, { lengthFt: 90 });
    expect(r).not.toBe('not_applicable');
    expect(r === 'not_applicable' ? null : r.verdict).toBe('too_long');
  });

  it('is unverified for a vessel booking with no vessel record', () => {
    const r = fitForBooking({ kind: 'vessel' }, null, { lengthFt: 90 });
    expect(r === 'not_applicable' ? null : r.verdict).toBe('unverified');
  });
});
