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
}) {
  const res = await m.createBooking(input);
  if (res.ok) revalidatePath('/');
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

/** Move a booking to another berth, to other dates, or both. */
export async function moveBookingAction(
  id: string,
  to: { berthId: string; start: string; end: string },
) {
  const res = await m.moveBooking(id, to);
  revalidatePath('/');
  // A move re-runs the fit check, so the queue and its badge can both change.
  revalidatePath('/review');
  return res;
}

export async function setVesselLengthAction(vesselId: string, lengthFt: number | null) {
  const res = await m.setVesselLength(vesselId, lengthFt);
  revalidatePath('/vessels');
  revalidatePath('/review');
  revalidatePath('/');
  return res;
}

export async function resolveReviewItemAction(id: string) {
  const res = await m.resolveReviewItem(id);
  revalidatePath('/review');
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

/** Put back the schedule the last Clear or Load replaced. Consumed on success. */
export async function restorePreviousAction() {
  const res = await m.restorePrevious();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

export async function clearScheduleAction() {
  const res = await m.clearSchedule();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

