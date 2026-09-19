import { describe, it, expect } from 'vitest';
import { relativeTime } from './cancelled';

const NOW = new Date('2026-09-19T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('calls the last minute "just now", because it usually is', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59 * SECOND), NOW)).toBe('just now');
  });

  it('counts minutes, then hours', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(4 * MINUTE), NOW)).toBe('4 minutes ago');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59 minutes ago');
    expect(relativeTime(ago(HOUR), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23 hours ago');
  });

  it('singularises at exactly one of each unit', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(HOUR), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 days ago');
  });

  it('says yesterday rather than "1 day ago"', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('yesterday');
    expect(relativeTime(ago(2 * DAY - SECOND), NOW)).toBe('yesterday');
  });

  it('switches to a date past a week, where "13 days ago" stops helping', () => {
    expect(relativeTime(ago(6 * DAY), NOW)).toBe('6 days ago');
    expect(relativeTime(ago(7 * DAY), NOW)).toBe('on 12 Sep');
    expect(relativeTime(ago(30 * DAY), NOW)).toBe('on 20 Aug');
  });

  it('reads a future timestamp as "just now" instead of a negative age', () => {
    // The database stamps cancelled_at, the server renders it; a second of skew
    // between them must not produce "-1 minutes ago".
    expect(relativeTime(new Date(NOW.getTime() + 30 * SECOND).toISOString(), NOW))
      .toBe('just now');
  });

  it('returns empty string rather than "Invalid Date" for junk', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});
