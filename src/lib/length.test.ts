import { describe, it, expect } from 'vitest';
import { parseLengthFt, MAX_LENGTH_FT } from './length';

describe('parseLengthFt', () => {
  it('reads a plain length', () => {
    expect(parseLengthFt('120')).toEqual({ ok: true, value: 120 });
    expect(parseLengthFt('  45  ')).toEqual({ ok: true, value: 45 });
  });

  it('treats blank as "no length on record", which must stay possible', () => {
    expect(parseLengthFt('')).toEqual({ ok: true, value: null });
    expect(parseLengthFt('   ')).toEqual({ ok: true, value: null });
  });

  /*
    The case this file exists for. Every one of these is finite, and the first two are
    integers, so a Number() + Number.isInteger() guard let them through — a length of
    1000ft silently recorded against a vessel turns "cannot verify" into a false answer.
  */
  it('refuses notation that Number() would happily accept', () => {
    for (const raw of ['1e3', '0x10', '0b101', '1_000', 'Infinity', '+40', '-40']) {
      expect(parseLengthFt(raw).ok, raw).toBe(false);
    }
  });

  it('names the decimal case rather than rounding it', () => {
    expect(parseLengthFt('45.5')).toEqual({ ok: false, error: 'Whole feet only.' });
  });

  it('refuses nonsense and out-of-range figures', () => {
    for (const raw of ['abc', '12ft', '0', String(MAX_LENGTH_FT + 1), '99999']) {
      expect(parseLengthFt(raw).ok, raw).toBe(false);
    }
  });

  it('accepts the boundary', () => {
    expect(parseLengthFt(String(MAX_LENGTH_FT))).toEqual({ ok: true, value: MAX_LENGTH_FT });
  });
});
