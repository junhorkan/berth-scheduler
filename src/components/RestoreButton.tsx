'use client';

import { useState, useTransition } from 'react';
import { restoreBookingAction } from '../app/actions';

/**
 * Undo a cancellation.
 *
 * The refusal is shown inline rather than thrown away, because it is the interesting
 * outcome: if the berth was rebooked in the meantime the database will not allow the
 * restore, and the person needs to be told that by name, not left with a button that
 * quietly did nothing.
 */
export function RestoreButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="restorewrap">
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await restoreBookingAction(id);
            if (!res.ok) setError(res.error ?? 'Could not restore it.');
          });
        }}
      >
        {pending ? '…' : 'Restore'}
      </button>
      {error && <span className="restoreerr">{error}</span>}
    </div>
  );
}
