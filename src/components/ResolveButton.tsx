'use client';

import { useTransition } from 'react';
import { resolveReviewItemAction } from '../app/actions';

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
