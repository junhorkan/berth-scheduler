import { describe, it, expect } from 'vitest';
import { shareInWords } from './share';

describe('shareInWords', () => {
  it('says half for the sample as imported: 1,002 of 1,974 bookings', () => {
    expect(shareInWords(1002, 1974)).toBe('half');
  });

  it('rounds down, so it never claims more than is true', () => {
    expect(shareInWords(49, 100)).toBe('a third');
    expect(shareInWords(74, 100)).toBe('two thirds');
    expect(shareInWords(94, 100)).toBe('three quarters');
    expect(shareInWords(99, 100)).toBe('nearly all');
    expect(shareInWords(100, 100)).toBe('all');
  });

  it('says nothing below a quarter, or when there is nothing to divide', () => {
    expect(shareInWords(24, 100)).toBeNull();
    expect(shareInWords(0, 100)).toBeNull();
    expect(shareInWords(5, 0)).toBeNull();
  });
});
