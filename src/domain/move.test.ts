import { describe, it, expect } from 'vitest';
import { checkMove } from './move';

const TODAY = '2026-09-22';

describe('checkMove', () => {
  it('accepts a forward move of a future booking', () => {
    expect(checkMove({
      currentStart: '2026-10-01', start: '2026-10-05', end: '2026-10-08', today: TODAY,
    })).toEqual({ ok: true });
  });

  it('accepts a single-day booking', () => {
    expect(checkMove({
      currentStart: '2026-10-01', start: '2026-10-05', end: '2026-10-05', today: TODAY,
    })).toEqual({ ok: true });
  });

  it('accepts a move that starts today', () => {
    expect(checkMove({
      currentStart: '2026-10-01', start: TODAY, end: TODAY, today: TODAY,
    })).toEqual({ ok: true });
  });

  it('refuses an end before its start', () => {
    const res = checkMove({
      currentStart: '2026-10-01', start: '2026-10-08', end: '2026-10-05', today: TODAY,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('before the start') });
  });

  it('refuses a missing date rather than storing an empty string', () => {
    expect(checkMove({ currentStart: '2026-10-01', start: '', end: '2026-10-05', today: TODAY }).ok)
      .toBe(false);
    expect(checkMove({ currentStart: '2026-10-01', start: '2026-10-05', end: '', today: TODAY }).ok)
      .toBe(false);
  });

  /*
    The rule that makes a move different from a booking. A future booking is live work
    and cannot be dragged behind today; an imported 2010 booking is a record, and a
    record can be corrected — otherwise all 2,031 of them would be uneditable, and a
    mistyped date could only be cancelled, which loses the row and its provenance.
  */
  it('refuses to move a booking that has not started yet into the past', () => {
    const res = checkMove({
      currentStart: '2026-10-01', start: '2026-09-01', end: '2026-09-03', today: TODAY,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('cannot be moved into the past') });
  });

  it('holds a booking starting today to the same floor', () => {
    expect(checkMove({
      currentStart: TODAY, start: '2026-09-21', end: '2026-09-23', today: TODAY,
    }).ok).toBe(false);
  });

  it('lets a booking already in the past be corrected within the past', () => {
    expect(checkMove({
      currentStart: '2010-07-04', start: '2010-07-06', end: '2010-07-09', today: TODAY,
    })).toEqual({ ok: true });
  });

  it('lets a past booking be corrected forward, across today', () => {
    expect(checkMove({
      currentStart: '2010-07-04', start: '2026-10-01', end: '2026-10-02', today: TODAY,
    })).toEqual({ ok: true });
  });
});
