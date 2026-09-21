/**
 * The part of the sample that lives in the coming weeks.
 *
 * Every booking in the workbook ended in 2019, and a booking cannot be made for a day
 * that has passed. So on the month the board opens to, a visitor could see the
 * strongest thing in the project — the database refusing an overlap — only by making
 * two bookings themselves, and the berth dropdown had seven free rows to say nothing
 * about. These are dated from the day the sample is loaded, so whoever loads it finds a
 * live board: a vessel too long for its berth, the berth the form opens onto already
 * taken on the day it opens to, events, closures, and two boats sharing the pooled
 * slips.
 *
 * Real names only. Every vessel is on the register the workbook built, and every label
 * is one the workbook uses. Nothing is invented but the dates. See DECISIONS 25.
 *
 * Pure, like the rest of `src/lib`, and unit-tested against the overlap rule: an
 * overlap here would make the database refuse the whole reload.
 */

export type SampleBooking = {
  kind: 'vessel' | 'event' | 'closure';
  /** The register name for a vessel; the label for an event or a closure. */
  label: string;
  /** The berth's name as the migration defines it. */
  berth: string;
  /** Days from the load date, inclusive at both ends. */
  from: number;
  to: number;
};

const POOLED = 'Small craft slips (institution boats)';

export const SAMPLE_BOOKINGS: readonly SampleBooking[] = [
  // North Pier West, 410ft. It is the first berth in display order, so the form opens
  // onto it, and it is taken on the day the form opens to: the first thing the verdict
  // says is the refusal, and "Find me a berth" has something to do.
  { kind: 'vessel',  label: 'R/V Long Ketch',     berth: 'North Pier West',  from: 0,  to: 6 },
  { kind: 'vessel',  label: 'R/V GOLDEN COMPASS', berth: 'North Pier West',  from: 15, to: 22 },
  { kind: 'vessel',  label: 'R/V Long Ketch',     berth: 'North Pier West',  from: 30, to: 38 },

  // North Pier Face, 75ft. The misfit: a 120ft vessel, drawn 1.6 lanes tall, in the
  // month the board opens to.
  { kind: 'vessel',  label: 'R/V CLEAR TERN',     berth: 'North Pier Face',  from: 2,  to: 4 },
  { kind: 'event',   label: 'Science stroll',     berth: 'North Pier Face',  from: 25, to: 25 },

  // North Pier East, 240ft. Vessels with a length on record that fit, drawn solid.
  { kind: 'event',   label: 'Community sail day', berth: 'North Pier East',  from: 3,  to: 3 },
  { kind: 'vessel',  label: 'M/V Iron Heron',     berth: 'North Pier East',  from: 7,  to: 11 },
  { kind: 'vessel',  label: 'M/Y Wild Tern',      berth: 'North Pier East',  from: 18, to: 21 },
  { kind: 'vessel',  label: 'F/V High Skua',      berth: 'North Pier East',  from: 33, to: 35 },

  // Inner Channel, 55ft.
  { kind: 'closure', label: 'Dock maintenance - restricted access', berth: 'Inner Channel', from: 5, to: 8 },
  { kind: 'vessel',  label: 'R/V Iron Ketch',     berth: 'Inner Channel',    from: 12, to: 14 },

  // South Float West, 90ft. The first of these runs across a month end.
  { kind: 'vessel',  label: 'OSV AMBER REEF',     berth: 'South Float West', from: 4,  to: 12 },
  { kind: 'vessel',  label: 'R/V SALT DRIFT',     berth: 'South Float West', from: 20, to: 23 },
  { kind: 'closure', label: 'Float rebuild - no usage permitted', berth: 'South Float West', from: 40, to: 44 },

  // South Float East, 90ft.
  { kind: 'vessel',  label: 'Barge SALT DORY',    berth: 'South Float East', from: 13, to: 17 },

  // Small craft slips, pooled: two institution boats at once, which is what pooled means.
  { kind: 'vessel',  label: 'M/V Amber Skua',     berth: POOLED, from: 1, to: 9 },
  { kind: 'vessel',  label: 'R/V Silver Petrel',  berth: POOLED, from: 6, to: 13 },
];

/** `2026-09-20` + 12 -> `2026-10-02`. Through UTC, so no timezone can shift a day. */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type DatedSampleBooking = SampleBooking & { start: string; end: string };

/** The bookings with their dates resolved against the day the sample is loaded. */
export function dateSampleBookings(todayISO: string): DatedSampleBooking[] {
  return SAMPLE_BOOKINGS.map((b) => ({
    ...b,
    start: addDays(todayISO, b.from),
    end: addDays(todayISO, b.to),
  }));
}
