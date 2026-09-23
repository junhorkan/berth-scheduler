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
  /** The furthest bookable date (`lastBookableISO`). Omitted, no ceiling is applied. */
  ceiling?: string;
}): MoveCheck {
  const { currentStart, start, end, today, ceiling } = input;

  if (!start || !end) return { ok: false, error: 'A booking needs both a start and an end date.' };
  if (end < start) return { ok: false, error: 'The end date cannot be before the start date.' };

  // A move must not push a booking past the board's reach either — the same hole
  // createBooking had, on the other write path. Invariant 7.
  if (ceiling && end > ceiling) {
    return { ok: false, error: `The schedule only takes bookings up to ${ceiling.slice(0, 4)}.` };
  }

  /*
    A move may not END a booking in the past, whichever way it is going.

    Without this, a booking that had started but not finished could have its end date
    set behind today — legal by the floor below, since that only holds a booking that
    has not started yet. The row then satisfies `hasEnded`, and `updateBooking` and
    `cancelBooking` both refuse it from that moment on: a booking nobody without the
    database credentials can correct or cancel, made in two steps with no warning.

    It is also the right rule on its own terms. A span that ends before today describes
    a stay that did not happen, and `createBooking` refuses to write one directly.
  */
  if (end < today) {
    return {
      ok: false,
      error: 'A booking cannot be changed to end on a day that has already passed.',
    };
  }

  // Only a booking that has not started yet is held to the scheduling floor.
  if (currentStart >= today && start < today) {
    return {
      ok: false,
      error: 'This booking has not started yet, so it cannot be moved into the past.',
    };
  }
  return { ok: true };
}
