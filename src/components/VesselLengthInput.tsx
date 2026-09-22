'use client';

import { useState, useTransition } from 'react';
import { setVesselLengthAction } from '../app/actions';

/**
 * Inline length entry. This is the highest-leverage control in the whole system:
 * every length recorded here converts that vessel's bookings from "cannot verify"
 * into a real answer, on the board and everywhere else.
 */
export default function VesselLengthInput({
  vesselId,
  lengthFt,
  bookingCount,
}: {
  vesselId: string;
  lengthFt: number | null;
  bookingCount: number;
}) {
  const [value, setValue] = useState(lengthFt == null ? '' : String(lengthFt));
  const [saved, setSaved] = useState<null | 'ok' | string>(null);
  const [pending, start] = useTransition();

  function save() {
    const n = value.trim() === '' ? null : Number(value);
    if (n != null && (!Number.isFinite(n) || n <= 0 || n > 2000)) {
      setSaved('Enter a length in feet.');
      return;
    }
    // Lengths are stored as whole feet. Postgres would silently round 45.5 to 46, and
    // quietly altering a recorded measurement is the wrong failure mode in a system
    // whose whole job is comparing that measurement against a berth.
    if (n != null && !Number.isInteger(n)) {
      setSaved('Whole feet only.');
      return;
    }
    start(async () => {
      const res = await setVesselLengthAction(vesselId, n);
      setSaved(res.ok ? 'ok' : res.error ?? 'Failed');
    });
  }

  return (
    <span className="lenwrap">
      <input
        className="leninput"
        inputMode="numeric"
        value={value}
        placeholder="—"
        aria-label={`Length in feet${bookingCount ? `, unlocks ${bookingCount} bookings` : ''}`}
        onChange={(e) => { setValue(e.target.value); setSaved(null); }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        disabled={pending}
      />
      {/* The unit belongs beside every box, not only the empty ones: a recorded length
          read as a bare "120", which is the number this whole system compares. */}
      <span className="unit">ft</span>
      {pending && <span className="hint">saving…</span>}
      {saved === 'ok' && <span className="hint ok">saved</span>}
      {saved && saved !== 'ok' && <span className="hint bad">{saved}</span>}
    </span>
  );
}
