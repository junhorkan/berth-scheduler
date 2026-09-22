'use client';

import { useState, useTransition } from 'react';
import { cancelBookingAction, moveBookingAction, checkBookingAction } from '../app/actions';
import type { BerthRow, BookingDetailRow } from '../db/queries';
import { checkFit } from '../domain/fit';
import { checkMove } from '../domain/move';
import { todayISO } from '../lib/nav';

/**
 * An existing booking: cancel it, or move it — to another berth, to other dates, or
 * both at once.
 *
 * A move re-runs BOTH checks. The conflict check is the database's either way, and a
 * date change re-evaluates it exactly as a berth change does, because `during` is
 * generated from the two dates. The fit check is recomputed for the berth's length.
 *
 * Dates are here rather than read-only because a vessel arriving two days late is at
 * least as common as one changing berth, and the alternative — cancel and rebook —
 * throws away the row, its import provenance and the review items attached to it.
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
  const [error, setError] = useState<string | null>(null);
  const [moveWarning, setMoveWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const target = berths.find((b) => b.id === berthId)!;
  const fit =
    booking.kind === 'vessel' ? checkFit(booking.vesselLengthFt, target.lengthFt) : null;
  const berthChanged = berthId !== booking.berthId;
  const moved =
    berthChanged || startDate !== booking.startDate || endDate !== booking.endDate;

  // The same function the save path runs, so the button and the server refuse for the
  // same reason in the same words, and the panel never enables a move the action will
  // reject. A booking already in the past is a record being corrected, so it has no
  // floor; one that has not started yet cannot be dragged behind today.
  const today = todayISO();
  const legal = checkMove({ currentStart: booking.startDate, start: startDate, end: endDate, today });
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

  function doReassign() {
    setError(null);
    setMoveWarning(null);
    start(async () => {
      const pre = await checkBookingAction({
        berthId, vesselId: booking.vesselId, kind: booking.kind,
        start: startDate, end: endDate, excludeBookingId: booking.id,
      });
      if (!pre.bookable) {
        setError(pre.blockedBecause ?? 'That berth is occupied for these dates.');
        return;
      }
      const res = await moveBookingAction(booking.id, { berthId, start: startDate, end: endDate });
      if (res.ok) window.location.href = closeHref;
      else setError(res.error ?? 'Could not move the booking.');
    });
  }

  return (
    <>
      <a className="overlay" href={closeHref} aria-label="Close" />
      <aside className="panel-sheet" role="dialog" aria-label="Booking">
        <h2>{booking.label}</h2>

        {/* Dates and berth are no longer stated here: they are the two fields below,
            which show the current values and are where they get changed. */}
        <dl className="meta">
          <dt>Berth</dt><dd>{booking.berthName}{booking.berthLengthFt != null ? ` — ${booking.berthLengthFt}ft` : ' — pooled'}</dd>
          <dt>Kind</dt><dd>{booking.kind}</dd>
          <dt>Vessel</dt>
          <dd>
            {booking.vesselName ?? '—'}
            {booking.kind === 'vessel' && (
              booking.vesselLengthFt != null
                ? ` (${booking.vesselLengthFt}ft)`
                : ' (no length on record)'
            )}
          </dd>
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
            {booking.notes ?? 'This booking overlaps another on the same berth.'} It was kept rather
            than discarded so the history stays true
            {/* Telling someone to resolve a stay that has already ended sends them to do
                work that means nothing (DECISIONS 26). It can still be moved, to correct
                the record, so this says what it is rather than that nothing can be done. */}
            {booking.endDate < todayISO()
              ? `. It ended on ${booking.endDate}, so it is history rather than work.`
              : '; move or cancel it to resolve.'}
          </p>
        )}

        <div className="field" style={{ marginTop: 14 }}>
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
              id="mvs" type="date" value={startDate} min={floor}
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
              id="mve" type="date" value={endDate} min={startDate || floor}
              aria-label="End date"
              onChange={(e) => { setEndDate(e.target.value); setError(null); }}
            />
          </div>
        </div>

        {!legal.ok && <p className="verdict stop">{legal.error}</p>}

        {berthChanged && fit && fit.verdict !== 'fits' && (
          <p className="verdict warn">
            <b>{fit.verdict === 'too_long' ? 'Does not fit there.' : 'Fit unverified there.'}</b>{' '}
            {fit.reason} This does not stop the move.
          </p>
        )}
        {berthChanged && fit?.verdict === 'fits' && <p className="verdict clear">{fit.reason}</p>}
        {error && <p className="verdict stop">{error}</p>}
        {moveWarning && <p className="verdict warn">{moveWarning}</p>}

        <div className="actions">
          <button className="btn primary" disabled={!moved || !legal.ok || pending} onClick={doReassign}>
            {pending ? 'Working…' : 'Move booking'}
          </button>
          <button className="btn danger" disabled={pending} onClick={doCancel}>Cancel booking</button>
          <a className="btn" href={closeHref}>Close</a>
        </div>
      </aside>
    </>
  );
}
