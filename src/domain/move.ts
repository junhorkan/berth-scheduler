/**
 * Moving an existing booking — to another berth, to other dates, or both.
 *
 * Creating and moving are not the same decision, and the date rule is where they part.
 * `createBooking` refuses a start before today outright: reserving a berth for a day
 * that has passed is nonsense. A move has to serve two jobs at once.
 *
 *   - **Scheduling.** A booking that has not started yet is live work. Dragging it
 *     backwards past today is the same nonsense as booking there in the first place,
 *     and is refused for the same reason.
 *   - **Correcting the record.** Every one of the 2,031 imported bookings is already in
 *     the past, and the booking panel says so of an ended conflict: *it can still be
 *     moved, to correct the record*. Applying the scheduling floor to those would make
 *     the entire imported schedule uneditable — a typed-wrong date from 2010 could never
 *     be fixed, only cancelled, which loses the row and its provenance with it.
 *
 * So the floor is decided by where the booking **is now**, not by where it is going:
 * a booking that already starts in the past is a record, and a record can be corrected.
 *
 * Pure, so the panel can disable its button and the save path can refuse with the same
 * sentence — the panel's rules are hints, and the action behind it is a public endpoint
 * (invariant 1, and the same reasoning as `createBooking`'s own past-date check).
 */

export type MoveCheck = { ok: true } | { ok: false; error: string };

export function checkMove(input: {
  /** Where the booking sits now — what decides whether this is scheduling or a fix. */
  currentStart: string;
  start: string;
  end: string;
  /** The facility's today, in America/New_York (`lib/nav`), never the server's UTC. */
  today: string;
}): MoveCheck {
  const { currentStart, start, end, today } = input;

  if (!start || !end) return { ok: false, error: 'A booking needs both a start and an end date.' };
  if (end < start) return { ok: false, error: 'The end date cannot be before the start date.' };

  // Only a booking that has not started yet is held to the scheduling floor.
  if (currentStart >= today && start < today) {
    return {
      ok: false,
      error: 'This booking has not started yet, so it cannot be moved into the past.',
    };
  }
  return { ok: true };
}
