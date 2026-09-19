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

/** Undo a cancellation. Refused by the constraint if the slot was taken meanwhile. */
export async function restoreBookingAction(id: string) {
  const res = await m.restoreBooking(id);
  revalidatePath('/');
  revalidatePath('/review');
  return res;
}

export async function reassignBookingAction(id: string, berthId: string) {
  const res = await m.reassignBooking(id, berthId);
  revalidatePath('/');
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

export async function clearScheduleAction() {
  const res = await m.clearSchedule();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

