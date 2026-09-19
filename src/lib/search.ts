/**
 * Finding a booking by name across 23 years.
 *
 * The board shows one month at a time, which is the right unit for the daily job and
 * useless for "when was this vessel last here?" — that answer is somewhere in 276
 * months. This module is the pure half of the answer: query normalization, LIKE
 * escaping, and grouping raw rows into one block per vessel or event. The SQL lives
 * in db/queries.ts.
 */
import type { BookingKind, BookingStatus } from '../domain/types';
import { MONTH_NAMES } from './nav';

/**
 * Below two characters a query matches most of the schedule, so the result is noise
 * rather than an answer. The page asks for more input instead of rendering it.
 */
export const MIN_QUERY_LENGTH = 2;

/** Bookings shown per group before the rest collapse behind a "Show all" link. */
export const HITS_PER_GROUP = 6;

/** One matching booking, as the search query returns it. */
export type SearchHit = {
  id: string;
  label: string;
  vesselId: string | null;
  vesselName: string | null;
  kind: BookingKind;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  berthName: string;
};

/**
 * All bookings that share one identity — a vessel, or a repeated event label such as
 * `Community sail day`. Grouping is what keeps a 312-booking vessel from burying
 * everything else in the results.
 */
export type SearchGroup = {
  key: string;
  name: string;
  kind: BookingKind;
  bookingCount: number;
  firstYear: number;
  lastYear: number;
  /** Most recent first. */
  hits: SearchHit[];
};

/** Collapse whitespace so " long   ketch " and "long ketch" are the same query. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Neutralize LIKE wildcards in user input.
 *
 * Without this, searching `100%` matches every booking and `_` matches any single
 * character — the user typed text, not a pattern. Backslash is LIKE's default escape
 * character, so escaping it first keeps a literal backslash literal.
 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A contains-match pattern for a user-supplied string. */
export function likePattern(raw: string): string {
  return `%${escapeLike(normalizeQuery(raw))}%`;
}

/**
 * A vessel groups by identity, so its spelling variants ('Barge SALT DORY' /
 * 'Barge Salt Dory') stay one block. Events and closures have no vessel row, so they
 * group by label — case-folded, because the source is inconsistent about it.
 */
function groupKeyFor(hit: SearchHit): string {
  if (hit.vesselId) return `v:${hit.vesselId}`;
  return `l:${normalizeQuery(hit.label).toUpperCase()}`;
}

/**
 * Bucket hits into groups, ordered by usefulness rather than alphabetically.
 *
 * A name that *starts* with the query is almost always the one meant, so those come
 * first; within that, the most-booked identity wins, since a name typed in full is
 * more likely to be the busy vessel than an incidental substring match.
 */
export function groupHits(rows: SearchHit[], query: string): SearchGroup[] {
  const q = normalizeQuery(query).toUpperCase();
  const map = new Map<string, SearchGroup>();

  for (const hit of rows) {
    const key = groupKeyFor(hit);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        name: hit.vesselName ?? normalizeQuery(hit.label),
        kind: hit.kind,
        bookingCount: 0,
        firstYear: Number.POSITIVE_INFINITY,
        lastYear: 0,
        hits: [],
      };
      map.set(key, group);
    }
    const year = Number(hit.startDate.slice(0, 4));
    group.bookingCount += 1;
    group.firstYear = Math.min(group.firstYear, year);
    group.lastYear = Math.max(group.lastYear, year);
    group.hits.push(hit);
  }

  const groups = [...map.values()];
  for (const group of groups) {
    group.hits.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }
  groups.sort((a, b) => {
    const aPrefix = a.name.toUpperCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.name.toUpperCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (a.bookingCount !== b.bookingCount) return b.bookingCount - a.bookingCount;
    return a.name.localeCompare(b.name);
  });
  return groups;
}

/**
 * A booking's span as a coordinator would write it: `Jul 6 – 19`, `Jun 28 – Jul 3`.
 *
 * Parsed from the ISO string's own components and never through `Date`, because
 * `new Date('2010-07-06')` is UTC midnight and reports July 5 in any western timezone —
 * a whole-day booking must not shift because of where the browser is.
 */
export function formatSpan(startDate: string, endDate: string): string {
  const [, startMonth, startDay] = startDate.split('-');
  const [, endMonth, endDay] = endDate.split('-');
  const from = `${monthAbbr(startMonth)} ${Number(startDay)}`;
  if (startDate === endDate) return from;
  if (startMonth === endMonth) return `${from} – ${Number(endDay)}`;
  return `${from} – ${monthAbbr(endMonth)} ${Number(endDay)}`;
}

function monthAbbr(month: string): string {
  return MONTH_NAMES[Number(month) - 1].slice(0, 3);
}

/** The board link that lands on a booking's own month with the booking selected. */
export function hitHref(hit: SearchHit): string {
  const year = Number(hit.startDate.slice(0, 4));
  const month = Number(hit.startDate.slice(5, 7));
  return `/?y=${year}&m=${month}&sel=${hit.id}`;
}
