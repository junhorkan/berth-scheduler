'use client';

import { useState, useTransition } from 'react';
import { resetToImportedAction, clearScheduleAction } from '../app/actions';

/**
 * The sample workbook is a demonstration, not this facility's history, so loading it
 * is an explicit, reversible choice rather than something baked into the deployment.
 *
 * Loading is additive and safe, so it appears wherever someone might want it. Clearing
 * destroys work, so it appears once, at the foot of Review, behind a confirmation.
 *
 * Both report failure. They used to `await` the action and throw the result away, so a
 * refusal — a cold database, an exhausted pool, a killed function — was indistinguishable
 * from success: the button flickered and the page did not change. Silence is the worst
 * possible answer from a destructive control.
 */
function useAction(run: () => Promise<{ ok: boolean; error?: string }>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () => {
    setError(null);
    start(async () => {
      try {
        const res = await run();
        if (!res.ok) setError(res.error ?? 'It did not go through. Try again.');
      } catch {
        // A killed or unreachable function rejects rather than returning !ok.
        setError('The server did not answer. Nothing was changed — try again.');
      }
    });
  };
  return { error, pending, go };
}

export function LoadSampleButton({ label = '↻ Load the sample schedule' }: { label?: string }) {
  const { error, pending, go } = useAction(resetToImportedAction);
  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          if (!confirm('Load the 23-year sample schedule? This replaces anything currently on the schedule.')) return;
          go();
        }}
      >
        {pending ? 'Loading…' : label}
      </button>
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}

export function ClearScheduleButton() {
  const { error, pending, go } = useAction(clearScheduleAction);
  return (
    <>
      <button
        className="btn danger"
        disabled={pending}
        onClick={() => {
          if (!confirm('Clear the whole schedule? Every booking and vessel is removed. The berths stay, and the sample can be loaded again.')) return;
          go();
        }}
      >
        {pending ? 'Clearing…' : '✕ Clear the schedule'}
      </button>
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}
