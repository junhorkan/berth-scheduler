'use client';

import { useTransition } from 'react';
import { resolveReviewGroupAction } from '../app/actions';

/** Closes every occurrence folded into a group, since the group is one decision. */
export function ResolveButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn"
      disabled={pending}
      onClick={() => start(async () => { await resolveReviewGroupAction(ids); })}
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}
