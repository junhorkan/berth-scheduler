/**
 * Every write the app performs.
 *
 * The database's exclusion constraint is the real guarantee — these functions check
 * first only so the UI can explain the problem before the user commits. If the two
 * ever disagree, the constraint wins and the insert throws, which is the correct
 * failure: a refused booking, never a silent double-booking.
 */
import { db } from './client';
import { findConflicts, isValidRange } from '../domain/conflicts';
import { checkFit, type FitResult } from '../domain/fit';
import type { Booking, BookingKind } from '../domain/types';

export type CheckResult = {
  bookable: boolean;
  /** Hard stop: overlapping bookings on this berth. */
  conflicts: { id: string; label: string; startDate: string; endDate: string }[];
  /** Advisory only. Never blocks. */
  fit: FitResult | null;
  /** Why Save is disabled, or null when it is not. */
  blockedBecause: string | null;
};

/**
 * Evaluate a candidate booking without writing anything.
 * Uses exactly the same domain functions the importer and the tests use.
 */
export async function checkBooking(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  start: string;
  end: string;
  excludeBookingId?: string;
}): Promise<CheckResult> {
  const sql = db();

  if (!isValidRange({ start: input.start, end: input.end })) {
    return {
      bookable: false,
      conflicts: [],
      fit: null,
      blockedBecause: 'The end date must not be before the start date.',
    };
  }

  const [berth] = await sql`
    select id, length_ft, capacity_mode from berths where id = ${input.berthId}`;
  if (!berth) {
    return { bookable: false, conflicts: [], fit: null, blockedBecause: 'Unknown berth.' };
  }

  const rows = await sql`
    select id, berth_id, vessel_id, kind, status, label, start_date, end_date
      from bookings
     where berth_id = ${input.berthId}
       and status = 'active'
       and start_date <= ${input.end}::date
       and end_date   >= ${input.start}::date`;

  const existing: Booking[] = rows.map((r) => ({
    id: r.id as string,
    berthId: r.berth_id as string,
    vesselId: r.vessel_id as string | null,
    kind: r.kind as BookingKind,
    status: 'active',
    label: r.label as string,
    range: {
      start: (r.start_date as Date).toISOString().slice(0, 10),
      end: (r.end_date as Date).toISOString().slice(0, 10),
    },
  }));

  const conflicts = findConflicts(
    { id: input.excludeBookingId, berthId: input.berthId, range: { start: input.start, end: input.end } },
    existing,
    { id: berth.id as string, capacityMode: berth.capacity_mode as 'exclusive' | 'pooled' },
  );

  let fit: FitResult | null = null;
  if (input.kind === 'vessel' && input.vesselId) {
    const [v] = await sql`select length_ft from vessels where id = ${input.vesselId}`;
    fit = checkFit((v?.length_ft as number | null) ?? null, (berth.length_ft as number | null) ?? null);
  }

  return {
    bookable: conflicts.length === 0,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      label: c.label,
      startDate: c.range.start,
      endDate: c.range.end,
    })),
    fit,
    blockedBecause:
      conflicts.length > 0
        ? `${conflicts[0].label} already holds this berth ${conflicts[0].range.start} to ${conflicts[0].range.end}.`
        : null,
  };
}

export async function createBooking(input: {
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  label: string;
  start: string;
  end: string;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sql = db();
  try {
    const [row] = await sql`
      insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date, notes, source)
      values (${input.berthId}, ${input.vesselId}, ${input.kind}, 'active', ${input.label},
              ${input.start}, ${input.end}, ${input.notes ?? null}, 'manual')
      returning id`;
    return { ok: true, id: row.id as string };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

export async function cancelBooking(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql`update bookings set status = 'cancelled' where id = ${id}`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/** Move a booking to a different berth. Both checks re-run against the NEW berth. */
export async function reassignBooking(
  id: string,
  berthId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql`update bookings set berth_id = ${berthId} where id = ${id}`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/** Recording a length is what turns 'cannot verify' into a real answer. */
export async function setVesselLength(
  vesselId: string,
  lengthFt: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql`
      update vessels
         set length_ft = ${lengthFt},
             length_source = ${lengthFt == null ? null : 'manual'}
       where id = ${vesselId}`;
    // A recorded length resolves that vessel's missing-length review item.
    if (lengthFt != null) {
      await sql`
        update review_items set resolved_at = now()
         where type = 'missing_length' and vessel_id = ${vesselId} and resolved_at is null`;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

export async function resolveReviewItem(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql`update review_items set resolved_at = now() where id = ${id}`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/**
 * Restore the exact imported state.
 *
 * The app is public and unauthenticated by design, so anyone can edit it — this is
 * what makes that safe to offer. Restoring from a snapshot taken at import time is
 * faster and more reliable than re-parsing the workbook inside a serverless function.
 */
export async function resetToImported(): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
      await tx`delete from berths`;
      await tx`insert into berths       select * from berths_seed`;
      await tx`insert into vessels      select * from vessels_seed`;
      await tx`insert into bookings     select * from bookings_seed`;
      await tx`insert into review_items select * from review_items_seed`;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeDbError(e) };
  }
}

/** Turn a Postgres error into something a dock coordinator can act on. */
function describeDbError(e: unknown): string {
  const err = e as { code?: string; constraint_name?: string; message?: string };
  if (err.code === '23P01') {
    return 'That berth is already occupied for part of those dates. The database refused the booking.';
  }
  if (err.code === '23514') {
    return 'Those dates are not valid for a booking.';
  }
  if (err.code === '22000') {
    return 'The end date must not be before the start date.';
  }
  return err.message ?? 'The database rejected that change.';
}
