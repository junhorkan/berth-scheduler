'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { cancelBookingAction, updateBookingAction, checkBookingAction } from '../app/actions';
import type { BerthRow, BookingDetailRow } from '../db/queries';
import type { CheckResult } from '../db/mutations';
import { checkFit } from '../domain/fit';
import { checkMove } from '../domain/move';
import { checkEdit, cleanNotes, isUnchanged } from '../domain/edit';
import type { BookingEdit } from '../domain/edit';
import type { BookingKind } from '../domain/types';
import { RestoreButton } from './RestoreButton';
import { todayISO, lastBookableISO } from '../lib/nav';

/**
 * An existing booking: cancel it, or correct it — the berth, the dates, the name, what
 * kind of thing it is, and the note.
 *
 * The berth and the dates re-run BOTH checks. The conflict check is the database's
 * either way, and a date change re-evaluates it exactly as a berth change does, because
 * `during` is generated from the two dates. The fit check is recomputed for the berth's
 * length.
 *
 * The third line, amber, is the same hull booked at another berth over the same days.
 * It is asked for on open rather than only after an edit, because unlike fit it cannot
 * be computed from this row — and because bookings that already clash came in with the
 * import, so the panel that opens on one should say so (domain/conflicts).
 *
 * Every field is here for one reason: the alternative is cancel and rebook, which throws
 * away the row, its import provenance and the review items attached to it. That trade
 * was refused for a date (ENGINEERING-LOG 32), and a mistyped vessel name is the same trade.
 * The note is the place for what the database cannot hold — shore power, crane reach, who
 * is arriving at 0600 (DECISIONS 22) — and the column existed, unwritable, until now.
 */
export default function BookingDetail({
  booking,
  berths,
  closeHref,
}: {
  booking: BookingDetailRow;
  berths: BerthRow[];
  closeHref: string;
}) {
  const [berthId, setBerthId] = useState(booking.berthId);
  const [startDate, setStartDate] = useState(booking.startDate);
  const [endDate, setEndDate] = useState(booking.endDate);
  const [kind, setKind] = useState<BookingKind>(booking.kind);
  // One field for both meanings, because `label` is one column: switching kind changes
  // what the name is called, not what has been typed into it.
  const [label, setLabel] = useState(booking.label);
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  /*
    The whole verdict, not only the advisory half.

    This effect already paid for the round trip and then kept `vesselClashes` and threw
    `bookable`, `conflicts` and `blockedBecause` away — so the edit panel showed no
    conflict at all and its Save stayed enabled until the click. The create panel has
    gated live on exactly this data since it was written.
  */
  const [check, setCheck] = useState<CheckResult | null>(null);
  const clashes = check?.vesselClashes ?? [];
  const [pending, start] = useTransition();

  const current: BookingEdit = {
    berthId: booking.berthId, start: booking.startDate, end: booking.endDate,
    label: booking.label, kind: booking.kind, notes: booking.notes,
  };
  const next: BookingEdit = {
    berthId, start: startDate, end: endDate, label, kind, notes,
  };
  // Declared here, above the live check that reads it: a renamed booking is about to
  // point at a different hull, which changes both the clash question and the fit answer.
  const renamed = label.trim() !== booking.label.trim();
  const edited = !isUnchanged(current, next);
  /*
    A conflict refuses the write, so the button must not offer it. The panel used to
    find out only after the click, from the pre-check in `doSave` — which still runs,
    because the action behind this form is a public endpoint and a button is not a
    guard. This is the same verdict, arriving 280ms after a change instead of after a
    click, and gating Save exactly as the create sheet's does.
  */
  const conflicted = check ? !check.bookable : false;
  const named = checkEdit({ kind, label });

  /*
    Where else this hull is, refreshed as the berth and dates change.

    Debounced and generation-counted for BookingPanel's reason: a slow earlier answer
    resolving after a faster later one would describe dates nobody is looking at. A
    cancelled booking holds nothing, and a booking with no vessel has no hull to be in
    two places, so neither asks.
  */
  const generation = useRef(0);
  useEffect(() => {
    if (booking.status === 'cancelled') return;
    const mine = ++generation.current;
    const t = setTimeout(async () => {
      try {
        const res = await checkBookingAction({
          berthId,
          // What the save will STORE, not what is stored now — the same arguments
          // doSave uses. Passing the original kind and vessel meant switching to Event
          // left the old hull's warnings on screen, and switching to Vessel produced
          // none at all.
          vesselId: kind === 'vessel' && !renamed ? booking.vesselId : null,
          kind,
          start: startDate, end: endDate, excludeBookingId: booking.id,
        });
        if (mine === generation.current) setCheck(res);
      } catch {
        // No answer is not a yes. The create panel learned this the same way: a stale
        // verdict left on screen reads as a guarantee about the current dates, and
        // Save is computed from it.
        if (mine === generation.current) setCheck(null);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [booking.id, booking.status, booking.vesselId, booking.kind,
      berthId, startDate, endDate, kind, renamed]);

  const target = berths.find((b) => b.id === berthId)!;
  /*
    The length on record belongs to the vessel this booking is linked to NOW. Once the
    name has been changed it describes a different hull — possibly one not yet on the
    register at all — so it is dropped rather than reused, and the strip says the fit
    cannot be verified. Invariant 2: a length is never invented, and carrying the old
    one across a rename would be inventing it.
  */
  const lengthOnRecord = kind === 'vessel' && !renamed ? booking.vesselLengthFt : null;
  const fit = kind === 'vessel' ? checkFit(lengthOnRecord, target.lengthFt) : null;
  const rechecked = berthId !== booking.berthId || renamed || kind !== booking.kind;

  // The same function the save path runs, so the button and the server refuse for the
  // same reason in the same words, and the panel never enables a move the action will
  // reject. A booking already in the past is a record being corrected, so it has no
  // floor; one that has not started yet cannot be dragged behind today.
  const today = todayISO();
  const ceiling = lastBookableISO();
  const legal = checkMove({
    currentStart: booking.startDate, start: startDate, end: endDate, today, ceiling,
  });
  const floor = booking.startDate >= today ? today : undefined;

  function doCancel() {
    // Say it is reversible BEFORE the click, not after: the reassurance is worthless
    // to someone deciding whether to press the button if they only find it afterwards.
    if (!confirm(
      `Cancel "${booking.label}" (${booking.startDate} to ${booking.endDate})? `
      + 'The berth becomes free. You can restore it from Review.',
    )) return;
    setError(null);
    start(async () => {
      const res = await cancelBookingAction(booking.id);
      if (res.ok) window.location.href = closeHref;
      else setError(res.error ?? 'Could not cancel.');
    });
  }

  function doSave() {
    setError(null);
    start(async () => {
      const pre = await checkBookingAction({
        berthId,
        // A renamed vessel is not this one any more, and an event has none at all, so
        // the pre-check is told what the save will store rather than what is stored now.
        vesselId: kind === 'vessel' && !renamed ? booking.vesselId : null,
        kind,
        start: startDate, end: endDate, excludeBookingId: booking.id,
      });
      if (!pre.bookable) {
        setError(pre.blockedBecause ?? 'That berth is occupied for these dates.');
        return;
      }
      const res = await updateBookingAction(booking.id, {
        berthId, start: startDate, end: endDate,
        label: label.trim(), kind, notes: cleanNotes(notes),
      });
      if (res.ok) window.location.href = closeHref;
      else setError(res.error ?? 'Could not save the booking.');
    });
  }

  /*
    A cancelled booking is reachable by its own URL — Review links to one, and so does
    anyone who kept the link. It used to offer "Cancel booking" on something already
    cancelled: an action that would do nothing, next to a Status line saying why.
    Restoring is the move that exists from here, and it is refused by the constraint if
    the slot has been taken since. So the whole form is behind one test rather than one
    per field, which is what stopped a sixth field being added to five guarded ones.
  */
  const editable = booking.status !== 'cancelled';

  return (
    <>
      <a className="overlay" href={closeHref} aria-label="Close" />
      <aside className="panel-sheet" role="dialog" aria-label="Booking">
        <h2>{booking.label}</h2>

        {/* The berth, the dates, the kind and the label are no longer stated here: they
            are the fields below, which show the current values and are where they get
            changed. What is left is what this panel cannot change — the hull on the
            register this row is linked to, whose length is recorded on the Vessels tab,
            and the provenance, which is a fact about the row rather than a field. The
            vessel is not the label: an imported booking's label is the spreadsheet's own
            text, and the register holds the canonical name it was matched to. */}
        <dl className="meta">
          {booking.kind === 'vessel' && (
            <>
              <dt>Vessel</dt>
              <dd>
                {booking.vesselName ?? '—'}
                {booking.vesselLengthFt != null
                  ? ` — ${booking.vesselLengthFt}ft on record`
                  : ' — no length on record'}
              </dd>
            </>
          )}
          <dt>Source</dt>
          <dd>
            {booking.source === 'import'
              ? `imported${booking.importSheet ? ` from sheet ${booking.importSheet}, row ${booking.importRow}` : ''}`
              : 'entered in this system'}
          </dd>
          {booking.status !== 'active' && (<><dt>Status</dt><dd>{booking.status.replace('_', ' ')}</dd></>)}
        </dl>

        {booking.status === 'conflict_unresolved' && (
          <p className="verdict stop">
            <b>Unresolved conflict from the legacy schedule.</b>{' '}
            This booking overlaps another on the same berth. It was kept rather
            than discarded so the history stays true
            {/* The overlap used to be explained with `booking.notes`, which is the same
                column the note field below writes to. Now that a coordinator can write
                there, reading it back as the system's own finding would print their
                sentence inside a red verdict box as though the constraint had said it —
                and the importer's own "Imported overlap with …" is still visible, in the
                field it was always stored in. */}
            {/* Telling someone to resolve a stay that has already ended sends them to do
                work that means nothing (DECISIONS 26). It can still be moved, to correct
                the record, so this says what it is rather than that nothing can be done. */}
            {booking.endDate < todayISO()
              ? `. It ended on ${booking.endDate}, so it is history rather than work.`
              : '; move or cancel it to resolve.'}
          </p>
        )}

        {editable && (
        <>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Kind</label>
          <div className="segmented">
            {(['vessel', 'event', 'closure'] as BookingKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'on' : ''}
                onClick={() => { setKind(k); setError(null); }}
              >
                {k === 'vessel' ? 'Vessel' : k === 'event' ? 'Event' : 'Closure'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="mvl">{kind === 'vessel' ? 'Vessel' : 'Description'}</label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              id="mvl"
              value={label}
              placeholder={kind === 'vessel' ? 'Vessel name' : 'What this booking is'}
              onChange={(e) => { setLabel(e.target.value); setError(null); }}
            />
            {/* Say what the save will do to the register before it does it: a corrected
                spelling joins the hull it names, and a name nobody has used yet becomes
                one. A hull whose last booking this was leaves the register, which is the
                same thing cancelling that booking does (invariant 2). */}
            {kind === 'vessel' && renamed && (
              <div className="sub-hint">
                Saving points this booking at that vessel, registering the name if it is new.
              </div>
            )}
            {kind !== 'vessel' && booking.kind === 'vessel' && (
              <div className="sub-hint">
                Saving takes the vessel off this booking, so it is no longer fit-checked.
              </div>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="mv">Berth</label>
          <select id="mv" value={berthId} onChange={(e) => { setBerthId(e.target.value); setError(null); }}>
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.lengthFt != null ? ` — ${b.lengthFt}ft` : ' — pooled'}
              </option>
            ))}
          </select>
        </div>

        {/*
          `min` guards the picker only, and only where there is a floor to guard: an
          imported 2010 booking is a record being corrected and has none. The rule is
          checkMove, run here and again in the save path.
        */}
        <div className="field dates">
          <label htmlFor="mvs">Dates</label>
          {/* The pair is one item, so it wraps under the label as a unit rather than
              leaving "to" stranded at the end of a line on a narrow panel. */}
          <div className="span">
            <input
              id="mvs" type="date" value={startDate} min={floor} max={ceiling}
              aria-label="Start date"
              onChange={(e) => {
                setStartDate(e.target.value);
                // Dragging the start past the end is a slip, not an intention.
                if (e.target.value > endDate) setEndDate(e.target.value);
                setError(null);
              }}
            />
            <span className="to">to</span>
            <input
              id="mve" type="date" value={endDate} min={startDate || floor} max={ceiling}
              aria-label="End date"
              onChange={(e) => { setEndDate(e.target.value); setError(null); }}
            />
          </div>
        </div>

        {/* The one thing this tool cannot check and the coordinator knows anyway. */}
        <div className="field">
          <label htmlFor="mvn">Note</label>
          <textarea
            id="mvn" rows={3} value={notes}
            placeholder="Anything the schedule cannot hold — shore power, crane reach, arriving 0600"
            onChange={(e) => { setNotes(e.target.value); setError(null); }}
          />
        </div>

        {!legal.ok && <p className="verdict stop">{legal.error}</p>}
        {legal.ok && !named.ok && <p className="verdict stop">{named.error}</p>}
        {legal.ok && named.ok && conflicted && (
          <p className="verdict stop">
            <b>Blocked &mdash; berth already occupied.</b>{' '}
            {check?.blockedBecause} The database will refuse this write.
          </p>
        )}
        </>
        )}

        {rechecked && fit && fit.verdict !== 'fits' && (
          <p className="verdict warn">
            <b>{fit.verdict === 'too_long' ? 'Does not fit there.' : 'Fit unverified there.'}</b>{' '}
            {fit.reason} This does not stop the change.
          </p>
        )}
        {rechecked && fit?.verdict === 'fits' && <p className="verdict clear">{fit.reason}</p>}

        {/* One line per clash, and the wording turns on the shared-day count: a single
            day is what a berth shift looks like, so it asks; two cannot be one, so it
            tells. Amber either way, and the Move button is untouched. */}
        {clashes.map((c) => (
          <p className="verdict warn" key={c.id}>
            {c.sharedDays === 1 ? (
              <>
                <b>Check — moving berth on {c.sharedStart}?</b>{' '}
                This vessel is also booked at {c.berthName}, {c.startDate} to {c.endDate}, and{' '}
                {c.sharedStart} is the only day the two share. If it is not a shift between
                berths that day, one of the two is wrong.
              </>
            ) : (
              <>
                <b>Warning — this vessel is booked elsewhere.</b>{' '}
                It is also at {c.berthName}, {c.startDate} to {c.endDate} — {c.sharedDays} days
                in common, and one hull cannot be in two places.
              </>
            )}{' '}
            This does not stop the change.
          </p>
        ))}
        {error && <p className="verdict stop">{error}</p>}

        <div className="actions">
          {editable ? (
            <>
              <button
                className="btn primary"
                disabled={!edited || !legal.ok || !named.ok || conflicted || pending}
                onClick={doSave}
              >
                {pending ? 'Working…' : 'Save changes'}
              </button>
              <button className="btn danger" disabled={pending} onClick={doCancel}>Cancel booking</button>
            </>
          ) : (
            <RestoreButton id={booking.id} />
          )}
          <a className="btn" href={closeHref}>Close</a>
        </div>
      </aside>
    </>
  );
}
