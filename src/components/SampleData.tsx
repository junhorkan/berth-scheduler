'use client';

import { useTransition } from 'react';
import { clearScheduleAction } from '../app/actions';

/**
 * The app is public and unauthenticated by design, so anyone can change the data.
 * This is what makes that safe to offer: it restores the state the app ships in —
 * an empty schedule with the berths intact.
 */
export function ClearScheduleButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn danger"
      disabled={pending}
      onClick={() => {
        if (!confirm('Clear the whole schedule? Every booking and vessel is removed. The berths stay.')) return;
        start(async () => { await clearScheduleAction(); });
      }}
    >
      {pending ? 'Clearing\u2026' : '\u2715 Clear the schedule'}
    </button>
  );
}
