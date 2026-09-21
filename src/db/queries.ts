/**
 * Every database read the app performs. Types are declared here, at the SQL boundary.
 */
import { cache } from 'react';
import { db } from './client';
import type { BookingKind, BookingStatus, BerthCapacityMode } from '../domain/types';
import { canonicalVesselName } from '../domain/normalize';
import { isSearchable, likePattern } from '../lib/search';
import type { SearchHit } from '../lib/search';

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

/**
 * The month nearest `fromISO` that actually holds a booking — forward first, then back.
 *
 * An empty board asks one question: is there nothing booked, or am I looking in the
 * wrong place? Without an answer the front door of a live schedule is a blank grid.
 * Forward first because a schedule people are using runs ahead of them; the fallback
 * reaches imported history, which is entirely behind.
 *
 * Called only when the month on screen is empty, so the common path never pays for it.
 */
export async function getNearestBookedMonth(
  fromISO: string,
): Promise<{ year: number; month: number } | null> {
  const sql = db();
  const [r] = await sql`
    select coalesce(
      (select min(start_date) from bookings
        where status <> 'cancelled' and end_date >= ${fromISO}),
      (select max(start_date) from bookings where status <> 'cancelled')
    ) as d`;
  const d = r?.d as Date | null;
  if (!d) return null;
  const iso = d.toISOString().slice(0, 10);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/**
 * Which active bookings overlap a date range, per berth.
 *
 * Only exclusive berths can be "taken": a pooled berth holds several boats at once, so
 * reporting a clash there would be a lie the conflict constraint does not tell either.
 *
 * Keyed by berth id and returned as a plain object so it crosses the server-action
 * boundary without ceremony; `src/lib/suggest` turns it into the wording.
 */
export async function getBerthOccupancy(
  start: string,
  end: string,
  excludeBookingId?: string,
): Promise<Record<string, { label: string; startDate: string; endDate: string }[]>> {
  const sql = db();
  const rows = await sql`
    select b.berth_id, b.label, b.start_date, b.end_date
      from bookings b
      join berths be on be.id = b.berth_id
     where b.status = 'active'
       and be.capacity_mode = 'exclusive'
       and b.during && daterange(${start}::date, (${end}::date + 1), '[)')
       and (${excludeBookingId ?? null}::uuid is null or b.id <> ${excludeBookingId ?? null}::uuid)
     order by b.start_date`;

  const out: Record<string, { label: string; startDate: string; endDate: string }[]> = {};
  for (const r of rows) {
    const key = r.berth_id as string;
    (out[key] ??= []).push({
      label: r.label as string,
      startDate: (r.start_date as Date).toISOString().slice(0, 10),
      endDate: (r.end_date as Date).toISOString().slice(0, 10),
    });
  }
  return out;
}

export type CancelledRow = {
  id: string;
  label: string;
  berthName: string;
  startDate: string;
  endDate: string;
  cancelledAt: string;
};

/**
 * Bookings cancelled through the app, newest first.
 *
 * `cancelled_at is not null` is what keeps this honest: every imported row has a null
 * here, so a freshly loaded sample shows no cancellation history at all, and the list
 * only ever holds something a person undid in this system.
 */
export async function getRecentlyCancelled(limit = 8): Promise<CancelledRow[]> {
  const sql = db();
  const rows = await sql`
    select b.id, b.label, b.start_date, b.end_date, b.cancelled_at, be.name as berth_name
      from bookings b
      join berths be on be.id = b.berth_id
     where b.status = 'cancelled' and b.cancelled_at is not null
     order by b.cancelled_at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    label: r.label as string,
    berthName: r.berth_name as string,
    startDate: (r.start_date as Date).toISOString().slice(0, 10),
    endDate: (r.end_date as Date).toISOString().slice(0, 10),
    cancelledAt: (r.cancelled_at as Date).toISOString(),
  }));
}

export type ClearUndo = { takenAt: string; bookings: number; vessels: number };

/**
 * What the last "Clear the schedule" removed, if it can still be put back.
 *
 * Null means there is nothing to undo — either nothing was ever cleared, or the
 * snapshot was consumed by an undo or retired by loading the sample. The counts are
 * read from the snapshot rather than recomputed, so the button can say what it will
 * restore before anybody presses it.
 */
export async function getClearUndo(): Promise<ClearUndo | null> {
  const sql = db();
  const [r] = await sql`
    select taken_at, bookings, vessels from clear_undo_meta where id = 1`;
  if (!r) return null;
  return {
    takenAt: (r.taken_at as Date).toISOString(),
    bookings: r.bookings as number,
    vessels: r.vessels as number,
  };
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
      -- Only what somebody can still act on: an item whose booking has not ended.
      -- An item with no booking at all is a cell from an old sheet, so the join drops
      -- it here and the history card below carries it instead. A badge that counts
      -- 2017 is a badge people learn to ignore.
      (select count(*)::int from review_items r
         join bookings b on b.id = r.booking_id
        where r.resolved_at is null and r.type <> 'missing_length'
          and b.end_date >= current_date) as open_review,
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

export type MissingLengthSummary = { vessels: number; bookings: number };

/**
 * How much of the schedule cannot be fit-checked, computed now rather than remembered.
 *
 * This used to be one stored review item per vessel — 398 of them, 93% of the queue,
 * all saying the same thing and burying the items that need a decision. Worse, the
 * count inside each was frozen at import: cancelling a vessel's last booking left an
 * item insisting its bookings could not be checked, and clearing a length produced no
 * item at all, because nothing outside the importer ever created one.
 *
 * Deriving it fixes both, because there is no stored state to go stale. The Vessels
 * tab is where the work happens; this is the pointer to it.
 */
export async function getMissingLengthSummary(): Promise<MissingLengthSummary> {
  const sql = db();
  const [r] = await sql`
    select count(distinct v.id)::int as vessels, count(b.id)::int as bookings
      from vessels v
      join bookings b
        on b.vessel_id = v.id and b.status <> 'cancelled' and b.kind = 'vessel'
     where v.length_ft is null`;
  return { vessels: r.vessels as number, bookings: r.bookings as number };
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
  /** Its booking has not ended yet, so a person can still do something about it. */
  isCurrent: boolean;
};

/** The coordinator's attention queue: open items, worst class first. */
export async function getReviewItems(limit = 200): Promise<ReviewRow[]> {
  const sql = db();
  const rows = await sql`
    select r.id, r.type, r.raw_text, r.detail, r.vessel_id, r.booking_id,
           b.start_date as booking_start, be.name as berth_name,
           r.import_sheet, r.import_row, r.import_col,
           (b.end_date >= current_date) as is_current
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
    // Null for an item with no booking — an unreadable cell — which is history.
    isCurrent: r.is_current === true,
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

/**
 * A ceiling on rows returned by one search.
 *
 * Deliberately above the total booking count in the imported workbook (~1,974), so with
 * this dataset no real query is truncated — the limit exists to bound the query if the
 * schedule grows, and the page says so when it bites rather than silently showing less.
 */
export const SEARCH_LIMIT = 2500;

export type SearchResult = { hits: SearchHit[]; truncated: boolean };

/**
 * Every booking whose label or vessel name contains the query, across all 23 years.
 *
 * Two arms, because the label and the vessel identity are not the same string. The
 * label is the raw spreadsheet text, which is what makes events ('Community sail day')
 * and closures ('Dock maintenance - restricted access') findable at all. The vessel arm
 * matches `normalized_name`, so a query typed as `OS/V` finds hulls stored as `OSV`
 * after canonicalization — searching the label alone would miss them.
 *
 * Cancelled bookings are excluded: this answers "what is on the schedule", and the
 * board does not draw them either.
 */
export async function searchBookings(query: string): Promise<SearchResult> {
  if (!isSearchable(query)) return { hits: [], truncated: false };

  const sql = db();
  const pattern = likePattern(query);
  const vesselPattern = likePattern(canonicalVesselName(query).normalized);

  const rows = await sql`
    select b.id, b.label, b.vessel_id, b.kind, b.status, b.start_date, b.end_date,
           be.name as berth_name, v.canonical_name as vessel_name
      from bookings b
      join berths be on be.id = b.berth_id
      left join vessels v on v.id = b.vessel_id
     where b.status <> 'cancelled'
       and (b.label ilike ${pattern} or v.normalized_name like ${vesselPattern})
     order by b.start_date desc
     limit ${SEARCH_LIMIT}`;

  return {
    hits: rows.map((r) => ({
      id: r.id as string,
      label: r.label as string,
      vesselId: r.vessel_id as string | null,
      vesselName: r.vessel_name as string | null,
      kind: r.kind as BookingKind,
      status: r.status as BookingStatus,
      startDate: (r.start_date as Date).toISOString().slice(0, 10),
      endDate: (r.end_date as Date).toISOString().slice(0, 10),
      berthName: r.berth_name as string,
    })),
    truncated: rows.length === SEARCH_LIMIT,
  };
}
