'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../db/mutations';
import * as q from '../db/queries';
import type { BookingKind } from '../domain/types';

/** Evaluate a candidate booking without writing. Drives the live verdict strip. */
export async function checkBookingAction(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  start: string;
  end: string;
  excludeBookingId?: string;
  vesselLengthFt?: number | null;
}) {
  return m.checkBooking(input);
}

export async function createBookingAction(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  label: string;
  start: string;
  end: string;
  notes?: string | null;
  vesselLengthFt?: number | null;
}) {
  const res = await m.createBooking(input);
  if (res.ok) {
    revalidatePath('/');
    // A length given here can create or retire a too-long item, so the queue and its
    // badge can both change on a path that never used to touch them.
    revalidatePath('/review');
    revalidatePath('/vessels');
  }
  return res;
}

export async function cancelBookingAction(id: string) {
  const res = await m.cancelBooking(id);
  revalidatePath('/');
  // Review now lists it under Recently cancelled, so that page is stale too.
  revalidatePath('/review');
  return res;
}

/**
 * What every berth is doing on a date range.
 *
 * Returns raw occupancy, not a recommendation: the wording and the ranking live in
 * `src/lib/suggest`, which is pure and unit-tested, and runs on the client that already
 * holds the berth list and the vessel's length.
 */
export async function berthOccupancyAction(
  start: string,
  end: string,
  excludeBookingId?: string,
) {
  return q.getBerthOccupancy(start, end, excludeBookingId);
}

/**
 * The vessel register, for the new-booking typeahead.
 *
 * Fetched when the panel first opens rather than passed down from the board. All 418
 * names, ids and lengths came to about 36KB of serialized props on every board render
 * — 40% of that page — and on every month click, to power a list most visits never
 * open. Typing works before it arrives: an unmatched name is a new vessel anyway, and
 * the save path resolves a known one by name on the server.
 */
export async function vesselOptionsAction() {
  return q.getVesselOptions();
}

/** Undo a cancellation. Refused by the constraint if the slot was taken meanwhile. */
export async function restoreBookingAction(id: string) {
  const res = await m.restoreBooking(id);
  revalidatePath('/');
  revalidatePath('/review');
  return res;
}

/** Change a booking's berth, dates, name, kind or note — whichever the panel changed. */
export async function updateBookingAction(
  id: string,
  to: {
    berthId: string;
    start: string;
    end: string;
    label: string;
    kind: BookingKind;
    notes: string | null;
  },
) {
  const res = await m.updateBooking(id, to);
  revalidatePath('/');
  // It re-runs the fit check, so the queue and its badge can both change; a rename can
  // also move a hull on or off the register, which the Vessels tab lists.
  revalidatePath('/review');
  revalidatePath('/vessels');
  return res;
}

export async function setVesselLengthAction(vesselId: string, lengthFt: number | null) {
  const res = await m.setVesselLength(vesselId, lengthFt);
  revalidatePath('/vessels');
  revalidatePath('/review');
  revalidatePath('/');
  return res;
}


export async function resetToImportedAction() {
  const res = await m.resetToImported();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

export async function resolveReviewGroupAction(ids: string[]) {
  const res = await m.resolveReviewItems(ids);
  revalidatePath('/review');
  revalidatePath('/');
  return res;
}

/** Put back the schedule the last restore replaced. Consumed on success. */
export async function restorePreviousAction() {
  const res = await m.restorePrevious();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

/*
  `clearScheduleAction` was here. The button that called it is gone: emptying a real
  23-year schedule is not a berth coordinator's action, and the empty board it existed to
  demonstrate is already the front door. The `clearSchedule` mutation stays — the
  Playwright fixture builds the empty schedule with it — but nothing on a public page
  reaches it now, which is the point.
*/

