'use client';

import { useTransition } from 'react';
import { resetToImportedAction, clearScheduleAction } from '../app/actions';

/**
 * The sample workbook is a demonstration, not this facility's history, so the app's
 * normal state is an empty schedule. These make loading it an explicit, reversible
 * choice rather than something baked into the deployment.
 *
 * Loading is additive and safe, so it appears wherever someone might want it. Clearing
 * destroys work, so it appears once, on the Review tab, behind a confirmation.
 */
export function LoadSampleButton({ label = '↻ Load the sample schedule' }: { label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn"
      disabled={pending}
      onClick={() => {
        if (!confirm('Load the 23-year sample schedule? This replaces anything currently on the schedule.')) return;
        start(async () => { await resetToImportedAction(); });
      }}
    >
      {pending ? 'Loading…' : label}
    </button>
  );
}

export function ClearScheduleButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn danger"
      disabled={pending}
      onClick={() => {
        if (!confirm('Clear the whole schedule? Every booking and vessel is removed. The berths stay, and the sample can be loaded again.')) return;
        start(async () => { await clearScheduleAction(); });
      }}
    >
      {pending ? 'Clearing…' : '✕ Clear the schedule'}
    </button>
  );
}
