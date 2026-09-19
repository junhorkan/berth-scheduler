/**
 * Every database read the app performs. Types are declared here, at the SQL boundary.
 */
import { cache } from 'react';
import { db } from './client';
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
  const sql = db();
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
  const sql = db();
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

/**
 * Wrapped in React's per-request cache: the nav and the page body both want these
 * counts, and without this every page would run the query twice on one render.
 */
export const getSummary = cache(async function getSummary(): Promise<SystemSummary> {
  const sql = db();
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
});

export type VesselRow = {
  id: string;
  canonicalName: string;
  lengthFt: number | null;
  loaFt: number | null;
  lengthSource: string | null;
  operator: string | null;
  bookingCount: number;
  lastSeen: string | null;
};

/**
 * The registry, ordered so the biggest data gaps surface first.
 *
 * Vessels with NO recorded length come first, ranked by how many bookings they make
 * unverifiable. That ordering is the most valuable thing on this page: 398 vessels
 * lack a length, which sounds hopeless, but the concentration is extreme — recording
 * the top ten alone makes roughly half of all bookings checkable.
 */
export async function getVessels(): Promise<VesselRow[]> {
  const sql = db();
  const rows = await sql`
    select v.id, v.canonical_name, v.length_ft, v.loa_ft, v.length_source, v.operator,
           count(b.id)::int as booking_count,
           max(b.end_date) as last_seen
      from vessels v
      left join bookings b on b.vessel_id = v.id and b.status <> 'cancelled'
     group by v.id
     order by (v.length_ft is not null), count(b.id) desc, v.canonical_name`;
  return rows.map((r) => ({
    id: r.id as string,
    canonicalName: r.canonical_name as string,
    lengthFt: r.length_ft as number | null,
    loaFt: r.loa_ft as number | null,
    lengthSource: r.length_source as string | null,
    operator: r.operator as string | null,
    bookingCount: r.booking_count as number,
    lastSeen: r.last_seen ? (r.last_seen as Date).toISOString().slice(0, 10) : null,
  }));
}

export type VesselOption = { id: string; name: string; lengthFt: number | null };

/**
 * Just enough to populate the new-booking typeahead.
 *
 * getVessels() joins 418 vessels against every booking and aggregates, which is the
 * right query for the Vessels tab and pure waste on the board — the board discards the
 * counts it pays for. The board renders on every month navigation, so it gets this.
 */
export async function getVesselOptions(): Promise<VesselOption[]> {
  const sql = db();
  const rows = await sql`
    select id, canonical_name, length_ft from vessels order by canonical_name`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.canonical_name as string,
    lengthFt: r.length_ft as number | null,
  }));
}

export type ReviewRow = {
  id: string;
  type: 'conflict' | 'too_long' | 'missing_length' | 'unclassified';
  rawText: string | null;
  detail: string | null;
  vesselId: string | null;
  bookingId: string | null;
  bookingStart: string | null;
  berthName: string | null;
  importSheet: string | null;
  importRow: number | null;
  importCol: number | null;
};

/** The coordinator's attention queue: open items, worst class first. */
export async function getReviewItems(limit = 200): Promise<ReviewRow[]> {
  const sql = db();
  const rows = await sql`
    select r.id, r.type, r.raw_text, r.detail, r.vessel_id, r.booking_id,
           b.start_date as booking_start, be.name as berth_name,
           r.import_sheet, r.import_row, r.import_col
      from review_items r
      left join bookings b on b.id = r.booking_id
      left join berths be on be.id = coalesce(r.berth_id, b.berth_id)
     where r.resolved_at is null
     order by case r.type
                when 'conflict' then 0
                when 'too_long' then 1
                when 'unclassified' then 2
                else 3
              end,
              r.created_at
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as ReviewRow['type'],
    rawText: r.raw_text as string | null,
    detail: r.detail as string | null,
    vesselId: r.vessel_id as string | null,
    bookingId: r.booking_id as string | null,
    bookingStart: r.booking_start ? (r.booking_start as Date).toISOString().slice(0, 10) : null,
    berthName: r.berth_name as string | null,
    importSheet: r.import_sheet as string | null,
    importRow: r.import_row as number | null,
    importCol: r.import_col as number | null,
  }));
}

export async function getReviewCounts(): Promise<Record<string, number>> {
  const sql = db();
  const rows = await sql`
    select type, count(*)::int as n from review_items
     where resolved_at is null group by type`;
  return Object.fromEntries(rows.map((r) => [r.type as string, r.n as number]));
}

export type BookingDetailRow = BookingRow & {
  berthName: string;
  berthLengthFt: number | null;
  vesselName: string | null;
  source: string;
  importSheet: string | null;
  importRow: number | null;
};

export async function getBookingById(id: string): Promise<BookingDetailRow | null> {
  const sql = db();
  const [r] = await sql`
    select b.id, b.berth_id, b.vessel_id, b.kind, b.status, b.label,
           b.start_date, b.end_date, b.notes, b.source, b.import_sheet, b.import_row,
           be.name as berth_name, be.length_ft as berth_length_ft,
           v.canonical_name as vessel_name, v.length_ft as vessel_length_ft
      from bookings b
      join berths be on be.id = b.berth_id
      left join vessels v on v.id = b.vessel_id
     where b.id = ${id}`;
  if (!r) return null;
  return {
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
    berthName: r.berth_name as string,
    berthLengthFt: r.berth_length_ft as number | null,
    vesselName: r.vessel_name as string | null,
    source: r.source as string,
    importSheet: r.import_sheet as string | null,
    importRow: r.import_row as number | null,
  };
}
