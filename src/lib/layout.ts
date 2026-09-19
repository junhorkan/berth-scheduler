/**
 * Board layout maths. Pure functions, unit tested — no React, no DOM.
 *
 * The board shows one month at a time (matching the grid staff have used for 23 years),
 * so two things need care:
 *
 *   1. A stay crossing a month boundary must be CLIPPED and marked, never shown as if
 *      it ended at the month edge. 49 stays in the source data cross a boundary.
 *   2. Several bars can legitimately share a lane: the pooled 'Small craft slips' berth
 *      holds multiple boats, and an imported conflict_unresolved row overlaps an active
 *      one by definition. Overlapping bars are packed into sub-lanes rather than drawn
 *      on top of each other, because a hidden booking is the failure mode this whole
 *      project exists to remove.
 */

export type DateRange = { start: string; end: string };

export function monthBounds(year: number, month: number): DateRange {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day-of-month for an ISO date. */
export function dayOf(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
}

export type ClippedSpan = {
  /** 1-based first visible day in this month. */
  startDay: number;
  /** 1-based last visible day in this month. */
  endDay: number;
  /** The stay began before this month. */
  clippedStart: boolean;
  /** The stay continues after this month. */
  clippedEnd: boolean;
};

/**
 * Clip a stay to the visible month, flagging either end that continues outside it.
 * Returns null when the stay does not touch this month at all.
 */
export function clipToMonth(
  span: DateRange,
  year: number,
  month: number,
): ClippedSpan | null {
  const b = monthBounds(year, month);
  if (span.end < b.start || span.start > b.end) return null;
  return {
    startDay: span.start < b.start ? 1 : dayOf(span.start),
    endDay: span.end > b.end ? daysInMonth(year, month) : dayOf(span.end),
    clippedStart: span.start < b.start,
    clippedEnd: span.end > b.end,
  };
}

/**
 * Greedily pack spans into the fewest sub-lanes such that no two spans in a sub-lane
 * overlap. Input order is preserved as the tie-break, so the board is stable between
 * renders.
 */
export function packLanes<T>(
  items: readonly T[],
  spanOf: (item: T) => { startDay: number; endDay: number },
): { item: T; lane: number }[] {
  const laneEnds: number[] = [];
  const out: { item: T; lane: number }[] = [];

  for (const item of [...items].sort((a, b) => spanOf(a).startDay - spanOf(b).startDay)) {
    const s = spanOf(item);
    let lane = laneEnds.findIndex((end) => end < s.startDay);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endDay);
    } else {
      laneEnds[lane] = s.endDay;
    }
    out.push({ item, lane });
  }
  return out;
}

/** Percentage geometry for a bar inside a month-wide track. */
export function barGeometry(startDay: number, endDay: number, totalDays: number) {
  const left = ((startDay - 1) / totalDays) * 100;
  const width = ((endDay - startDay + 1) / totalDays) * 100;
  return { left, width };
}
