/**
 * Editing a booking's *record* — what it is called, what kind of thing it is, and what
 * the coordinator wrote down about it — as opposed to where and when it sits, which is
 * `move.ts`.
 *
 * The two are one save and one transaction, but the rules are different in kind: a span
 * is judged against the calendar and the constraint, a name is judged against the vessel
 * register. This module holds the second half, pure, because both ends need it — the
 * panel to know whether there is anything to save and to refuse in words, and the write
 * path because the action behind the panel is a public endpoint (invariant 1).
 */
import type { BookingKind } from './types';

export type BookingEdit = {
  berthId: string;
  start: string;
  end: string;
  label: string;
  kind: BookingKind;
  notes: string | null;
};

export type EditCheck = { ok: true } | { ok: false; error: string };

/**
 * A textarea yields `''` when it is empty; the column holds `null`.
 *
 * Left alone the two differ on every comparison, so opening a booking with no note and
 * touching nothing would read as an edit and offer to save `''` over the `null` that is
 * already there. Whitespace is the same non-note as an empty box.
 */
export function cleanNotes(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Nothing to save. Compare `notes` cleaned, for the reason `cleanNotes` gives. */
export function isUnchanged(a: BookingEdit, b: BookingEdit): boolean {
  return a.berthId === b.berthId
    && a.start === b.start
    && a.end === b.end
    && a.kind === b.kind
    && a.label.trim() === b.label.trim()
    && cleanNotes(a.notes) === cleanNotes(b.notes);
}

/**
 * What a vessel booking's name must satisfy before the write is attempted.
 *
 * `bookings.vessel_id` is `not null` for `kind = 'vessel'` by CHECK constraint
 * (`vessel_required_for_vessel_kind`), and a blank name resolves to no vessel — so
 * saving one would be refused by Postgres as a check violation, class 23514, which the
 * shared error text reads as a *date* problem. Refusing it here is the difference
 * between "name the vessel" and "those dates are not valid for a booking".
 *
 * An event or a closure has no vessel, but it still has to be called something: the
 * board draws the label, and search matches on it.
 */
export function checkEdit(next: { kind: BookingKind; label: string }): EditCheck {
  if (next.label.trim() !== '') return { ok: true };
  return next.kind === 'vessel'
    ? { ok: false, error: 'Name the vessel this booking is for.' }
    : { ok: false, error: 'Give this booking a name.' };
}

/**
 * What has to happen to `vessel_id`, given the edit.
 *
 * The register is built by INNER JOINing vessels to their bookings (invariant 2), so
 * `vessel_id` is the only thing that makes a hull real. Three cases, and each is a way
 * to get the register wrong:
 *
 *  - **`clear`** — this is no longer a vessel booking. The row must lose its vessel or
 *    the fit check keeps measuring a hull against a berth nobody is bringing it to.
 *  - **`resolve`** — a rename, or a kind that has just become `vessel`, or a vessel
 *    booking that somehow has no link. The new name is looked up and registered if it
 *    is new, exactly as `createBooking` does it, so a corrected spelling joins the
 *    existing hull instead of inventing a second one.
 *  - **`keep`** — same kind, same name. Deliberately NOT a re-resolve: an imported
 *    booking's label is the spreadsheet's raw text and its vessel is the canonical name,
 *    so re-resolving an untouched label would look up a name the register does not hold
 *    and register a duplicate hull on every save that changed only the dates.
 */
export type VesselLink =
  | { action: 'clear' }
  | { action: 'resolve'; name: string }
  | { action: 'keep' };

export function vesselLinkFor(
  current: { kind: BookingKind; label: string; vesselId: string | null },
  next: { kind: BookingKind; label: string },
): VesselLink {
  if (next.kind !== 'vessel') return { action: 'clear' };
  if (
    current.kind !== 'vessel'
    || current.vesselId == null
    || current.label.trim() !== next.label.trim()
  ) {
    return { action: 'resolve', name: next.label.trim() };
  }
  return { action: 'keep' };
}
