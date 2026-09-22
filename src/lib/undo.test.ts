import { describe, it, expect } from 'vitest';
import { afterReplace, nothingToLose } from './undo';
import type { Schedule, UndoState, ReplaceAction } from './undo';

const EMPTY: Schedule = { id: 'empty', active: 0, isSample: false };
const SAMPLE: Schedule = { id: 'sample', active: 2031, isSample: true };
const produces = { empty: EMPTY, sample: SAMPLE };

/** Somebody's work: active bookings, and not the untouched sample. */
let n = 0;
const work = (): Schedule => ({ id: `work${++n}`, active: 3, isSample: false });

/**
 * Between replaces, visitors change things. Editing makes the live schedule new work;
 * it is how real content comes to exist, and so what the undo has to protect.
 */
type Step = ReplaceAction | 'edit';
function step(state: UndoState, s: Step) {
  if (s === 'edit') return { live: work(), snapshot: state.snapshot };
  return afterReplace(state, s, produces);
}

const STARTS: UndoState[] = [
  { live: EMPTY, snapshot: null },
  { live: SAMPLE, snapshot: null },
  { live: work(), snapshot: null },
  { live: EMPTY, snapshot: work() },
  { live: SAMPLE, snapshot: work() },
  { live: work(), snapshot: work() },
];

/** Every sequence of `len` steps. 4 steps ^ 6 = 4,096 per start. */
function* sequences(len: number): Generator<Step[]> {
  const steps: Step[] = ['clear', 'load', 'restore', 'edit'];
  if (len === 0) { yield []; return; }
  for (const rest of sequences(len - 1)) for (const s of steps) yield [...rest, s];
}

/** Run every sequence up to 6 long from every start, calling `check` after each step. */
function everySequence(check: (before: UndoState, s: Step, after: UndoState | { refused: string }) => void) {
  let runs = 0;
  for (const start of STARTS) {
    for (const seq of sequences(6)) {
      let state = start;
      for (const s of seq) {
        const next = step(state, s);
        check(state, s, next);
        if ('refused' in next) break;
        state = next;
      }
      runs++;
    }
  }
  return runs;
}

describe('nothingToLose', () => {
  it('is true for an empty schedule and for the untouched sample, and nothing else', () => {
    expect(nothingToLose(EMPTY)).toBe(true);
    expect(nothingToLose(SAMPLE)).toBe(true);
    expect(nothingToLose(work())).toBe(false);
  });

  it('counts a schedule with only cancelled bookings as empty, as the board does', () => {
    // A cancelled booking used to count as content here while the board called the same
    // schedule empty, so it could overwrite the very snapshot the board was offering.
    expect(nothingToLose({ id: 'x', active: 0, isSample: false })).toBe(true);
  });

  it('counts a changed sample as work, because Load cannot make it again', () => {
    expect(nothingToLose({ id: 'x', active: 2032, isSample: false })).toBe(false);
  });
});

describe('the undo policy, over every sequence of up to six actions', () => {
  it('never lets a replace destroy a schedule that had something to lose', () => {
    // The central guarantee, and the one Put back used to break: it deleted whatever was
    // live without saving it, so a stranger could wipe days of work with one click.
    const runs = everySequence((before, s, after) => {
      if (s === 'edit' || 'refused' in after) return;
      if (!nothingToLose(before.live)) expect(after.snapshot).toBe(before.live);
    });
    expect(runs).toBe(STARTS.length * 4 ** 6);
  });

  it('only ever holds a snapshot worth putting back', () => {
    // So the offer never restores an empty schedule, or the sample that is already there.
    everySequence((_b, _s, after) => {
      if ('refused' in after) return;
      if (after.snapshot) expect(nothingToLose(after.snapshot)).toBe(false);
    });
  });

  it('refuses Put back exactly when there is nothing to put back', () => {
    everySequence((before, s, after) => {
      if (s !== 'restore') return;
      expect('refused' in after).toBe(before.snapshot === null);
    });
  });

  it('keeps the snapshot when the action replaces nothing worth keeping', () => {
    everySequence((before, s, after) => {
      if (s === 'edit' || s === 'restore' || 'refused' in after) return;
      if (nothingToLose(before.live)) expect(after.snapshot).toBe(before.snapshot);
    });
  });
});

describe('the sequences that were bugs', () => {
  it('Put back is a swap: pressing it twice returns to where you were', () => {
    const w1 = work(); const w2 = work();
    const once = afterReplace({ live: w2, snapshot: w1 }, 'restore', produces) as UndoState;
    expect(once).toEqual({ live: w1, snapshot: w2 });
    const twice = afterReplace(once, 'restore', produces) as UndoState;
    expect(twice).toEqual({ live: w2, snapshot: w1 });
  });

  it('Load, then work on the sample, then Put back: the new work is not lost', () => {
    // The exact case a reviewer constructed: after a Load, days of bookings are made on
    // the sample, then somebody presses Put back. It used to delete them with no way back.
    const mine = work();
    let s = afterReplace({ live: mine, snapshot: null }, 'load', produces) as UndoState;
    s = step(s, 'edit') as UndoState;
    const theirs = s.live;
    s = afterReplace(s, 'restore', produces) as UndoState;
    expect(s.live).toBe(mine);
    expect(s.snapshot).toBe(theirs);
  });

  it('Load twice keeps the snapshot of your work, instead of replacing it with the sample', () => {
    const mine = work();
    let s = afterReplace({ live: mine, snapshot: null }, 'load', produces) as UndoState;
    s = afterReplace(s, 'load', produces) as UndoState;
    expect(s.snapshot).toBe(mine);
  });

  it('Load on a fresh site offers nothing to put back', () => {
    // It used to offer to "put back 2,031 bookings" — the ones already on the screen.
    const s = afterReplace({ live: SAMPLE, snapshot: null }, 'load', produces) as UndoState;
    expect(s.snapshot).toBeNull();
  });

  it('Clear, then an accidental Load, still recovers what was there before the Clear', () => {
    const mine = work();
    let s = afterReplace({ live: mine, snapshot: null }, 'clear', produces) as UndoState;
    s = afterReplace(s, 'load', produces) as UndoState;
    s = afterReplace(s, 'restore', produces) as UndoState;
    expect(s.live).toBe(mine);
  });

  it('Clear, then Put back, then nothing left to offer', () => {
    const mine = work();
    let s = afterReplace({ live: mine, snapshot: null }, 'clear', produces) as UndoState;
    s = afterReplace(s, 'restore', produces) as UndoState;
    expect(s).toEqual({ live: mine, snapshot: null });
  });
});

describe('what one slot cannot do, stated rather than hidden', () => {
  it('keeps only the most recent work: a newer save displaces an older one', () => {
    // Load over W1, then work on the sample, then Load again: that second Load replaces
    // new work, so it is saved and W1 goes. Holding both would need a history, not a slot.
    const w1 = work();
    let s = afterReplace({ live: w1, snapshot: null }, 'load', produces) as UndoState;
    s = step(s, 'edit') as UndoState;
    const w2 = s.live;
    s = afterReplace(s, 'load', produces) as UndoState;
    expect(s.snapshot).toBe(w2);
    expect(s.snapshot).not.toBe(w1);
  });
});
