'use client';

import { useState, useTransition } from 'react';
import { cancelBookingAction, reassignBookingAction, checkBookingAction } from '../app/actions';
import type { BerthRow, BookingDetailRow } from '../db/queries';
import { checkFit } from '../domain/fit';
import { todayISO } from '../lib/nav';

/**
 * An existing booking: cancel it, or move it to another berth.
 *
 * Reassignment re-runs BOTH checks against the new berth — the conflict check is
 * enforced by the database either way, and the fit check is recomputed because the
 * berth's length has changed. Moving a vessel is the most common real operation a
 * coordinator performs, which is why it is here rather than deferred.
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
  const [error, setError] = useState<string | null>(null);
  const [moveWarning, setMoveWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const target = berths.find((b) => b.id === berthId)!;
  const fit =
    booking.kind === 'vessel' ? checkFit(booking.vesselLengthFt, target.lengthFt) : null;
  const moved = berthId !== booking.berthId;

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
        start: booking.startDate, end: booking.endDate, excludeBookingId: booking.id,
      });
      if (!pre.bookable) {
        setError(pre.blockedBecause ?? 'That berth is occupied for these dates.');
        return;
      }
      const res = await reassignBookingAction(booking.id, berthId);
      if (res.ok) window.location.href = closeHref;
      else setError(res.error ?? 'Could not move the booking.');
    });
  }

  return (
    <>
      <a className="overlay" href={closeHref} aria-label="Close" />
      <aside className="panel-sheet" role="dialog" aria-label="Booking">
        <h2>{booking.label}</h2>

        <dl className="meta">
          <dt>Dates</dt><dd>{booking.startDate} to {booking.endDate}</dd>
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
          <label htmlFor="mv">Move to</label>
          <select id="mv" value={berthId} onChange={(e) => { setBerthId(e.target.value); setError(null); }}>
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.lengthFt != null ? ` — ${b.lengthFt}ft` : ' — pooled'}
              </option>
            ))}
          </select>
        </div>

        {moved && fit && fit.verdict !== 'fits' && (
          <p className="verdict warn">
            <b>{fit.verdict === 'too_long' ? 'Does not fit there.' : 'Fit unverified there.'}</b>{' '}
            {fit.reason} This does not stop the move.
          </p>
        )}
        {moved && fit?.verdict === 'fits' && <p className="verdict clear">{fit.reason}</p>}
        {error && <p className="verdict stop">{error}</p>}
        {moveWarning && <p className="verdict warn">{moveWarning}</p>}

        <div className="actions">
          <button className="btn primary" disabled={!moved || pending} onClick={doReassign}>
            {pending ? 'Working…' : 'Move booking'}
          </button>
          <button className="btn danger" disabled={pending} onClick={doCancel}>Cancel booking</button>
          <a className="btn" href={closeHref}>Close</a>
        </div>
      </aside>
    </>
  );
}
