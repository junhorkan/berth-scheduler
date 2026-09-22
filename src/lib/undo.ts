/**
 * The undo policy, as a pure state machine.
 *
 * Three actions replace the whole schedule: Clear, Load the sample, and Put back. There
 * is one snapshot slot. Every undo bug found in review was in the *policy* — which state
 * gets saved, and when — not in the SQL that moves rows, so the policy lives here where
 * it can be tested against every sequence of actions, and `src/db/mutations.ts` follows
 * it step for step. See DECISIONS 30.
 *
 * ONE RULE, for all three actions: **an action saves what it replaces, unless that has
 * nothing to lose.** A schedule has nothing to lose when it has no active bookings, or
 * when it is the untouched sample, because Load can always make that again.
 *
 * What the rule buys, each proved by the tests:
 *  - Put back is a swap, so it can never destroy work; pressing it again undoes it.
 *  - Loading over the untouched sample keeps the snapshot of your real work.
 *  - Clearing an empty schedule, or Loading over one, keeps the snapshot too — so Clear
 *    followed by an accidental Load still recovers what was there before the Clear.
 *  - The snapshot is only ever a schedule worth putting back, so the offer to put one
 *    back is never an offer to restore nothing or to restore what is already there.
 *
 * Pure, like the rest of `src/lib`: no database, no React.
 */

/** A schedule, reduced to what the policy needs to know about it. */
export type Schedule = {
  /** Identity, for tests and for reading a sequence back. Opaque to the policy. */
  id: string;
  /** Bookings that are not cancelled. The board calls a schedule empty when this is 0. */
  active: number;
  /** True when it is exactly the sample as loaded, with nothing changed. */
  isSample: boolean;
};

export type UndoState = { live: Schedule; snapshot: Schedule | null };

export type ReplaceAction = 'clear' | 'load' | 'restore';

/**
 * Whether replacing this schedule would lose anything.
 *
 * "No active bookings" is deliberately the same test the board uses to say *The
 * schedule is empty*. Using a stricter one here — any row at all — let a single
 * cancelled booking make an empty-looking board count as content, and overwrite the
 * snapshot the board was offering to put back.
 */
export function nothingToLose(s: Schedule): boolean {
  return s.active === 0 || s.isSample;
}

/**
 * The state after an action. `empty` and `sample` are the schedules Clear and Load
 * produce. Put back with no snapshot is refused rather than treated as a no-op, so a
 * stale button can never quietly do something other than what it said.
 */
export function afterReplace(
  state: UndoState,
  action: ReplaceAction,
  produces: { empty: Schedule; sample: Schedule },
): UndoState | { refused: string } {
  const keep = nothingToLose(state.live);

  if (action === 'restore') {
    if (state.snapshot === null) return { refused: 'There is no previous schedule to put back.' };
    // A swap: what is live now becomes the snapshot, unless it has nothing to lose.
    return { live: state.snapshot, snapshot: keep ? null : state.live };
  }

  const live = action === 'clear' ? produces.empty : produces.sample;
  return { live, snapshot: keep ? state.snapshot : state.live };
}
