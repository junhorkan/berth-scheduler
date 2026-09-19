/**
 * Which berth should this booking go in?
 *
 * The brief's second failure is *"verifying that a vessel actually fits the berth it has
 * been assigned to"* — assigned, by a person. This attacks that one level up: if the
 * system proposes the berth, there is less left to verify.
 *
 * It **suggests and explains**; it never assigns. Two reasons, and the second is the one
 * that matters:
 *
 *  - 97.5% of vessels in the source have no recorded length, so for most bookings the
 *    system cannot know whether anything fits. It says so rather than guessing.
 *  - A coordinator knows what the database does not: shore power, crane reach, which
 *    float is nearest the lab, who is arriving at 0600. An assignment that silently
 *    ignores all of it is confidently wrong, and confidently wrong is how a tool loses
 *    the room.
 *
 * Pure, like the rest of `src/lib` — no database, no React.
 */
import { formatSpan } from './search';

export type Occupancy = { label: string; startDate: string; endDate: string };

export type BerthLike = {
  id: string;
  name: string;
  lengthFt: number | null;
  capacityMode: 'exclusive' | 'pooled';
};

export type BerthChoice = {
  berthId: string;
  /** What the dropdown shows: name, length, and what it is doing on these dates. */
  optionLabel: string;
  free: boolean;
  /** `null` when there is no vessel to fit — an event or a closure. */
  fit: 'fits' | 'too_long' | 'unverified' | null;
  pooled: boolean;
  lengthFt: number | null;
};

function fitOf(vesselLengthFt: number | null, berthLengthFt: number | null) {
  if (vesselLengthFt == null || berthLengthFt == null) return 'unverified' as const;
  return vesselLengthFt <= berthLengthFt ? ('fits' as const) : ('too_long' as const);
}

/**
 * One row per berth, each saying what it is doing on the requested dates.
 *
 * The status is written out in the option text rather than shown as a colour, because a
 * `<select>` cannot be relied on to render colour and this has to survive being read
 * aloud by a screen reader.
 */
export function describeChoices(
  berths: BerthLike[],
  occupancy: Map<string, Occupancy[]>,
  vesselLengthFt: number | null,
  isVessel: boolean,
): BerthChoice[] {
  return berths.map((b) => {
    const pooled = b.capacityMode === 'pooled';
    // A pooled berth holds several boats at once, so it is never "taken".
    const busy = pooled ? [] : occupancy.get(b.id) ?? [];
    const free = busy.length === 0;
    const fit = isVessel ? fitOf(vesselLengthFt, b.lengthFt) : null;

    const size = b.lengthFt != null ? `${b.lengthFt}ft` : 'pooled';
    let status: string;
    if (!free) {
      const first = busy[0];
      status = `taken ${formatSpan(first.startDate, first.endDate)}`;
      if (busy.length > 1) status += ` +${busy.length - 1} more`;
    } else if (pooled) {
      status = 'shared, no fit check';
    } else if (fit === 'too_long') {
      status = `free, ${vesselLengthFt! - b.lengthFt!}ft too short`;
    } else if (fit === 'fits') {
      status = 'free, fits';
    } else if (fit === 'unverified') {
      status = 'free, fit unchecked';
    } else {
      status = 'free';
    }

    return {
      berthId: b.id,
      optionLabel: `${b.name} — ${size} · ${status}`,
      free,
      fit,
      pooled,
      lengthFt: b.lengthFt,
    };
  });
}

export type Suggestion = { berthId: string; reason: string } | { berthId: null; reason: string };

/**
 * Best-fit: the **smallest** free berth the vessel fits in.
 *
 * Smallest rather than first, so a 40ft launch does not consume the 410ft pier and leave
 * nothing for a ship that genuinely needs it. This is the standard bin-packing heuristic,
 * which matters less for being optimal than for being one sentence to explain.
 *
 * Pooled berths are never suggested. Small craft slips can always accept another boat, so
 * it would win every time and mean nothing.
 */
export function suggestBerth(
  choices: BerthChoice[],
  vesselLengthFt: number | null,
): Suggestion {
  const free = choices.filter((c) => c.free && !c.pooled);
  if (free.length === 0) {
    return { berthId: null, reason: 'Every berth is taken for at least part of those dates.' };
  }

  // No length on record, or not a vessel at all: availability is the only fact there is.
  if (vesselLengthFt == null) {
    return {
      berthId: free[0].berthId,
      reason: 'First berth free for the whole stay. No length on record, so fit is not checked.',
    };
  }

  const fitting = free
    .filter((c) => c.fit === 'fits' && c.lengthFt != null)
    .sort((a, b) => a.lengthFt! - b.lengthFt!);

  if (fitting.length === 0) {
    const longest = free
      .filter((c) => c.lengthFt != null)
      .sort((a, b) => b.lengthFt! - a.lengthFt!)[0];
    return {
      berthId: null,
      reason: longest
        ? `No free berth is long enough for ${vesselLengthFt}ft — the longest free one is ${longest.lengthFt}ft.`
        : `No free berth has a recorded length to check ${vesselLengthFt}ft against.`,
    };
  }

  const best = fitting[0];
  return {
    berthId: best.berthId,
    reason: `Smallest free berth that fits ${vesselLengthFt}ft, so the longer ones stay open.`,
  };
}
