import { describe, it, expect } from 'vitest';
import { checkEdit, cleanNotes, isUnchanged, vesselLinkFor } from './edit';
import type { BookingEdit } from './edit';

const BASE: BookingEdit = {
  berthId: 'berth-1',
  start: '2026-10-01',
  end: '2026-10-04',
  label: 'R/V Tern',
  kind: 'vessel',
  notes: null,
};

describe('cleanNotes', () => {
  it('reads an empty or blank box as no note', () => {
    expect(cleanNotes('')).toBeNull();
    expect(cleanNotes('   \n ')).toBeNull();
    expect(cleanNotes(null)).toBeNull();
    expect(cleanNotes(undefined)).toBeNull();
  });

  it('keeps a real note, trimmed', () => {
    expect(cleanNotes('  Arriving 0600, needs shore power\n')).toBe('Arriving 0600, needs shore power');
  });
});

describe('isUnchanged', () => {
  it('sees no edit in a booking nobody touched', () => {
    expect(isUnchanged(BASE, { ...BASE })).toBe(true);
  });

  // The trap this exists for: the panel holds notes in a textarea, which is '' when the
  // stored note is null. Compared raw, every booking with no note opens dirty.
  it('does not call an empty box a change to a null note', () => {
    expect(isUnchanged(BASE, { ...BASE, notes: '' })).toBe(true);
    expect(isUnchanged({ ...BASE, notes: 'Shore power' }, { ...BASE, notes: ' Shore power ' })).toBe(true);
  });

  it('sees each field', () => {
    expect(isUnchanged(BASE, { ...BASE, berthId: 'berth-2' })).toBe(false);
    expect(isUnchanged(BASE, { ...BASE, start: '2026-10-02' })).toBe(false);
    expect(isUnchanged(BASE, { ...BASE, end: '2026-10-05' })).toBe(false);
    expect(isUnchanged(BASE, { ...BASE, label: 'R/V Terne' })).toBe(false);
    expect(isUnchanged(BASE, { ...BASE, kind: 'event' })).toBe(false);
    expect(isUnchanged(BASE, { ...BASE, notes: 'Crane booked' })).toBe(false);
  });
});

describe('checkEdit', () => {
  it('accepts a named booking of either kind', () => {
    expect(checkEdit({ kind: 'vessel', label: 'R/V Tern' })).toEqual({ ok: true });
    expect(checkEdit({ kind: 'closure', label: 'Float rebuild' })).toEqual({ ok: true });
  });

  /*
    Without this the write reaches `vessel_required_for_vessel_kind`, a CHECK violation
    (23514), and the shared error text for that class talks about dates — so a blank
    vessel name would come back as "those dates are not valid for a booking".
  */
  it('refuses a vessel booking with no vessel named, in those words', () => {
    const res = checkEdit({ kind: 'vessel', label: '   ' });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('Name the vessel') });
  });

  it('refuses an unnamed event, which the board would draw as a blank bar', () => {
    expect(checkEdit({ kind: 'event', label: '' }).ok).toBe(false);
  });
});

describe('vesselLinkFor', () => {
  const current = { kind: 'vessel' as const, label: 'R/V Tern', vesselId: 'v-1' };

  it('re-resolves a renamed vessel, so the register follows the correction', () => {
    expect(vesselLinkFor(current, { kind: 'vessel', label: 'R/V Terne' }))
      .toEqual({ action: 'resolve', name: 'R/V Terne' });
  });

  // Re-resolving an untouched label would look up the spreadsheet's raw text rather
  // than the canonical name the importer linked, and register a second hull for it.
  it('leaves the link alone when only the berth or the dates moved', () => {
    expect(vesselLinkFor(current, { kind: 'vessel', label: 'R/V Tern' }))
      .toEqual({ action: 'keep' });
    expect(vesselLinkFor(current, { kind: 'vessel', label: ' R/V Tern ' }))
      .toEqual({ action: 'keep' });
  });

  it('clears the link when the booking stops being a vessel', () => {
    expect(vesselLinkFor(current, { kind: 'event', label: 'Open day' })).toEqual({ action: 'clear' });
    expect(vesselLinkFor(current, { kind: 'closure', label: 'Float rebuild' })).toEqual({ action: 'clear' });
  });

  // The other direction: an event has no vessel, so becoming one has to find or make it,
  // or the CHECK constraint refuses the write.
  it('resolves one when an event or closure becomes a vessel booking', () => {
    expect(vesselLinkFor({ kind: 'event', label: 'Open day', vesselId: null }, { kind: 'vessel', label: 'R/V Tern' }))
      .toEqual({ action: 'resolve', name: 'R/V Tern' });
  });

  it('resolves one for a vessel booking that somehow has no link', () => {
    expect(vesselLinkFor({ kind: 'vessel', label: 'R/V Tern', vesselId: null }, { kind: 'vessel', label: 'R/V Tern' }))
      .toEqual({ action: 'resolve', name: 'R/V Tern' });
  });
});
