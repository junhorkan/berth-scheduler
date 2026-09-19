'use client';

import { useTransition } from 'react';
import { resolveReviewItemAction, resetToImportedAction } from '../app/actions';

export function ResolveButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn"
      disabled={pending}
      onClick={() => start(async () => { await resolveReviewItemAction(id); })}
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}

/**
 * The app is public and unauthenticated by design, so anyone can change the data.
 * This is what makes that safe to offer: it restores the exact imported state.
 */
export function ResetButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn danger"
      disabled={pending}
      onClick={() => {
        if (!confirm('Restore all 2,031 imported bookings and discard every change made since? This cannot be undone.')) return;
        start(async () => { await resetToImportedAction(); });
      }}
    >
      {pending ? 'Restoring…' : '↺ Reset to imported state'}
    </button>
  );
}
