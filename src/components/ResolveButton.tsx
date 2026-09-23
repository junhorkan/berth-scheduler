'use client';

import { useState, useTransition } from 'react';
import { resolveReviewGroupAction } from '../app/actions';

/**
 * Closes every occurrence folded into a group, since the group is one decision.
 *
 * It reports failure. The result used to be awaited and thrown away, so a refusal — a
 * cold database, an exhausted pool, a killed function — was indistinguishable from
 * success: the row stayed, and you pressed it again. "Never throw a mutation's result
 * away" is a rule this file was breaking.
 */
export function ResolveButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              const res = await resolveReviewGroupAction(ids);
              if (!res.ok) setError(res.error ?? 'It did not go through. Try again.');
            } catch {
              setError('The server did not answer. Nothing was changed — try again.');
            }
          });
        }}
      >
        {pending ? '…' : 'Mark done'}
      </button>
      {error && <span className="actionerr">{error}</span>}
    </>
  );
}
