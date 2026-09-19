'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../db/mutations';
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

export async function clearScheduleAction() {
  const res = await m.clearSchedule();
  revalidatePath('/');
  revalidatePath('/vessels');
  revalidatePath('/review');
  return res;
}

