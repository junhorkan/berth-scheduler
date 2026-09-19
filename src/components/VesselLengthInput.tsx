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
        placeholder="— ft"
        aria-label={`Length in feet${bookingCount ? `, unlocks ${bookingCount} bookings` : ''}`}
        onChange={(e) => { setValue(e.target.value); setSaved(null); }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        disabled={pending}
      />
      {pending && <span className="hint">saving…</span>}
      {saved === 'ok' && <span className="hint ok">saved</span>}
      {saved && saved !== 'ok' && <span className="hint bad">{saved}</span>}
    </span>
  );
}
