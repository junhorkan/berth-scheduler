/**
 * Every database read the app performs. Types are declared here, at the SQL boundary.
 */
import { sql } from './client';
import type { BookingKind, BookingStatus, BerthCapacityMode } from '../domain/types';

export type BerthRow = {
  id: string;
  name: string;
  lengthFt: number | null;
  capacityMode: BerthCapacityMode;
  displayOrder: number;
};

export type BookingRow = {
  id: string;
  berthId: string;
  vesselId: string | null;
  kind: BookingKind;
  status: BookingStatus;
  label: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  vesselLengthFt: number | null;
};

export async function getBerths(): Promise<BerthRow[]> {
  const rows = await sql`
    select id, name, length_ft, capacity_mode, display_order
      from berths
     where active
     order by display_order`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    lengthFt: r.length_ft as number | null,
    capacityMode: r.capacity_mode as BerthCapacityMode,
    displayOrder: r.display_order as number,
  }));
}

/** Bookings overlapping the given inclusive date window, with vessel length joined. */
export async function getBookingsInRange(start: string, end: string): Promise<BookingRow[]> {
  const rows = await sql`
    select b.id, b.berth_id, b.vessel_id, b.kind, b.status, b.label,
           b.start_date, b.end_date, b.notes, v.length_ft as vessel_length_ft
      from bookings b
      left join vessels v on v.id = b.vessel_id
     where b.status <> 'cancelled'
       and b.start_date <= ${end}::date
       and b.end_date   >= ${start}::date
     order by b.start_date`;
  return rows.map((r) => ({
    id: r.id as string,
    berthId: r.berth_id as string,
    vesselId: r.vessel_id as string | null,
    kind: r.kind as BookingKind,
    status: r.status as BookingStatus,
    label: r.label as string,
    startDate: (r.start_date as Date).toISOString().slice(0, 10),
    endDate: (r.end_date as Date).toISOString().slice(0, 10),
    notes: r.notes as string | null,
    vesselLengthFt: r.vessel_length_ft as number | null,
  }));
}

export type SystemSummary = {
  berths: number;
  vessels: number;
  vesselsWithLength: number;
  bookings: number;
  unresolvedConflicts: number;
  openReviewItems: number;
  firstYear: number;
  lastYear: number;
};

export async function getSummary(): Promise<SystemSummary> {
  const [r] = await sql`
    select
      (select count(*)::int from berths)  as berths,
      (select count(*)::int from vessels) as vessels,
      (select count(*)::int from vessels where length_ft is not null) as vessels_with_length,
      (select count(*)::int from bookings where status <> 'cancelled') as bookings,
      (select count(*)::int from bookings where status = 'conflict_unresolved') as unresolved,
      (select count(*)::int from review_items where resolved_at is null) as open_review,
      (select extract(year from min(start_date))::int from bookings) as first_year,
      (select extract(year from max(start_date))::int from bookings) as last_year`;
  return {
    berths: r.berths as number,
    vessels: r.vessels as number,
    vesselsWithLength: r.vessels_with_length as number,
    bookings: r.bookings as number,
    unresolvedConflicts: r.unresolved as number,
    openReviewItems: r.open_review as number,
    firstYear: r.first_year as number,
    lastYear: r.last_year as number,
  };
}
