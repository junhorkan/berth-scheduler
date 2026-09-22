'use client';

import { useState, useTransition } from 'react';
import { resetToImportedAction, clearScheduleAction, restorePreviousAction } from '../app/actions';

/**
 * The sample workbook is a demonstration, not this facility's history, so loading it
 * is an explicit, reversible choice rather than something baked into the deployment.
 *
 * Both replace the whole schedule and both can be undone: each keeps what it replaced,
 * and "Put back the previous schedule" restores it. Loading appears wherever someone
 * might want it; clearing appears once, at the foot of Review, behind a confirmation.
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
          if (!confirm('Load the 23-year sample schedule? It replaces what is on the schedule now, and you can put that back afterwards.')) return;
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
          if (!confirm('Clear the whole schedule? Every booking and vessel is removed. The berths stay, and you can put it all back afterwards.')) return;
          go();
        }}
      >
        {pending ? 'Clearing…' : '✕ Clear the schedule'}
      </button>
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}

/**
 * Put back the schedule the last Clear or Load replaced.
 *
 * Rendered only when there is a snapshot, which keeps it from being a button that
 * usually does nothing. It says what it will restore before it is pressed, because
 * restoring replaces the current schedule and the person should know the size of that
 * before they commit to it.
 */
export function RestorePreviousButton({
  bookings,
  vessels,
  kind,
  when,
}: {
  bookings: number;
  vessels: number;
  kind: 'clear' | 'load';
  /** Relative, e.g. "4 minutes ago". Rendered by the caller, which has lib/cancelled. */
  when?: string;
}) {
  const { error, pending, go } = useAction(restorePreviousAction);
  const how = kind === 'clear' ? 'Cleared' : 'Replaced by the sample';
  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          if (!confirm(
            `Put back the ${bookings.toLocaleString()} booking${bookings === 1 ? '' : 's'} and `
            + `${vessels.toLocaleString()} vessel${vessels === 1 ? '' : 's'} that were here before? `
            + 'This replaces whatever is on the schedule now.',
          )) return;
          go();
        }}
      >
        {pending ? 'Putting it back…' : '↩ Put back the previous schedule'}
      </button>
      {when && <span className="sub-hint">{how} {when}.</span>}
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}
