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

  it('refuses a date that is not a date, before comparing any of them', () => {
    // Every check here is a string comparison, and `'20260-01-01' > '2029-12-31'` is
    // false — they diverge where 6 sorts below 9 — so a five-digit year cleared the
    // ceiling invariant 7 exists to enforce. Shape is checked first now.
    for (const bad of ['20260-01-01', '2026-9-25', '2026-09-23 BC', '2026-09-23T00:00:00']) {
      expect(checkMove({
        currentStart: '2026-10-01', start: bad, end: '2029-12-30', today: TODAY,
        ceiling: '2029-12-31',
      }).ok).toBe(false);
    }
  });

  it('refuses an end before its start', () => {
    const res = checkMove({
      currentStart: '2026-10-01', start: '2026-10-08', end: '2026-10-05', today: TODAY,
    });
    expect(res.ok).toBe(false);
    // `isValidRange` catches an inverted span first, so the wording is the shape rule's.
    // Both refuse; what matters is that neither lets it through.
    expect(res.ok).toBe(false);
  });

  it('refuses a missing date rather than storing an empty string', () => {
    expect(checkMove({ currentStart: '2026-10-01', start: '', end: '2026-10-05', today: TODAY }).ok)
      .toBe(false);
    expect(checkMove({ currentStart: '2026-10-01', start: '2026-10-05', end: '', today: TODAY }).ok)
      .toBe(false);
  });

  /*
    This asserted the other half of the old rule: a future booking could not be dragged
    behind today, but an imported 2010 booking was a record and a record could be
    CORRECTED — otherwise all 2,031 of them would be uneditable.

    That half is gone, and deliberately (`src/domain/record.ts`). On a public page with
    no accounts, "anyone may correct the record" is "anyone may rewrite 23 years of
    somebody else's history, permanently". The correction stays with whoever holds the
    database credentials. So `hasEnded` refuses an ended booking before `checkMove` is
    ever reached, and `checkMove` refuses any span that would END in the past — which
    subsumes the floor below for anything moving wholly backwards.

    The floor still earns its place for the case the new rule does not cover: a booking
    that has not started, dragged to START behind today while still ending ahead of it.
  */
  it('refuses to move a booking that has not started yet into the past', () => {
    const res = checkMove({
      currentStart: '2026-10-01', start: '2026-09-01', end: '2026-09-30', today: TODAY,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('cannot be moved into the past') });
  });

  it('holds a booking starting today to the same floor', () => {
    expect(checkMove({
      currentStart: TODAY, start: '2026-09-21', end: '2026-09-23', today: TODAY,
    }).ok).toBe(false);
  });

  it('no longer lets a past booking be corrected within the past', () => {
    // It used to. `updateBooking` now refuses an ended booking outright, so this is the
    // domain agreeing with the write path rather than quietly permitting what the write
    // path will reject — the two disagreeing is the failure invariant 1 exists to stop.
    expect(checkMove({
      currentStart: '2010-07-04', start: '2010-07-06', end: '2010-07-09', today: TODAY,
    }).ok).toBe(false);
  });

  it('lets a past booking be corrected forward, across today', () => {
    expect(checkMove({
      currentStart: '2010-07-04', start: '2026-10-01', end: '2026-10-02', today: TODAY,
    })).toEqual({ ok: true });
  });
});

describe('checkMove ceiling', () => {
  const CEILING = '2029-12-31';

  it('refuses a move past the furthest bookable date', () => {
    const res = checkMove({
      currentStart: '2026-10-01', start: '2030-01-01', end: '2030-01-02',
      today: TODAY, ceiling: CEILING,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('2029') });
  });

  it('allows a move that ends exactly on the ceiling', () => {
    expect(checkMove({
      currentStart: '2026-10-01', start: '2029-12-30', end: CEILING,
      today: TODAY, ceiling: CEILING,
    })).toEqual({ ok: true });
  });

  it('applies no ceiling when none is given', () => {
    expect(checkMove({
      currentStart: '2026-10-01', start: '2099-01-01', end: '2099-01-02', today: TODAY,
    })).toEqual({ ok: true });
  });
});

/**
 * The trap this rule exists to close: a booking that has started but not ended could be
 * edited to end behind today, which makes it a record — and a record refuses every
 * further edit and every cancel. Two steps, no warning, and a row only the database
 * credentials could fix.
 */
describe('a move may not end a booking in the past', () => {
  const today = '2026-09-23';

  it('refuses a running booking being shortened to end yesterday', () => {
    const r = checkMove({ currentStart: '2026-09-20', start: '2026-09-20', end: '2026-09-22', today });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/already passed/);
  });

  it('refuses an upcoming booking being dragged wholly behind today', () => {
    const r = checkMove({ currentStart: '2026-10-01', start: '2026-09-01', end: '2026-09-03', today });
    expect(r.ok).toBe(false);
  });

  it('allows a running booking to end today, which is still work', () => {
    expect(checkMove({ currentStart: '2026-09-20', start: '2026-09-20', end: today, today }).ok).toBe(true);
  });

  it('allows a running booking to be extended', () => {
    expect(checkMove({ currentStart: '2026-09-20', start: '2026-09-20', end: '2026-09-30', today }).ok).toBe(true);
  });
});
