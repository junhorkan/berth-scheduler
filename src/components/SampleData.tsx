'use client';

import { useState, useTransition } from 'react';
import { resetToImportedAction, restorePreviousAction } from '../app/actions';

/**
 * Putting the schedule back to the one it was loaded with, and undoing that.
 *
 * Restoring replaces the whole schedule and can be undone: it keeps what it replaced,
 * and "Put back the previous schedule" restores that. It appears wherever someone might
 * want it — the foot of Review, and the empty board.
 *
 * There was a third button, `ClearScheduleButton`, which emptied the schedule. It was
 * removed: it existed to show that an empty schedule is supported, which the front door
 * already shows, and it was the one control on a public page that could delete a real
 * 23-year record in a press. The `clearSchedule` mutation stays — `e2e/helpers/schedule`
 * calls it to build the empty-schedule fixture — it is simply not a button any more.
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

export function LoadSampleButton({ label = '↻ Restore the original schedule' }: { label?: string }) {
  const { error, pending, go } = useAction(resetToImportedAction);
  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          if (!confirm('Restore the original schedule? It replaces what is on the schedule now, and you can put that back afterwards.')) return;
          go();
        }}
      >
        {pending ? 'Restoring…' : label}
      </button>
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}

/**
 * Put back the schedule the last restore replaced.
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
  kind: 'clear' | 'load' | 'restore';
  /** Relative, e.g. "4 minutes ago". Rendered by the caller, which has lib/cancelled. */
  when?: string;
}) {
  const { error, pending, go } = useAction(restorePreviousAction);
  // 'clear' is still reachable: the `clearSchedule` mutation snapshots under that name,
  // and the Playwright fixture calls it. Only the button is gone, not the code path.
  const how = kind === 'clear' ? 'Cleared'
    : kind === 'load' ? 'Replaced by the original schedule'
      : 'Replaced by Put back';
  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          if (!confirm(
            `Put back the ${bookings.toLocaleString()} booking${bookings === 1 ? '' : 's'} and `
            + `${vessels.toLocaleString()} vessel${vessels === 1 ? '' : 's'} that were here before? `
            + 'What is on the schedule now is kept, so you can put it back again.',
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
