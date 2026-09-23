'use client';

import { useState, useTransition } from 'react';
import { setVesselLengthAction } from '../app/actions';
import { parseLengthFt } from '../lib/length';

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
    // Parsed by lib/length, not by Number(): this field writes the one column the whole
    // fit check compares against, and Number('1e3') is a silent 1000.
    const parsed = parseLengthFt(value);
    if (!parsed.ok) {
      setSaved(parsed.error);
      return;
    }
    const n = parsed.value;
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
