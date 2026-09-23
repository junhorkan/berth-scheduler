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
/**
 * What counts as "the same thing" across two hits.
 *
 * A hull is its id. Everything else is its label — AND its kind, which this used to
 * leave out: an event and a closure sharing a label folded into one group whose badge
 * was whichever hit arrived first, while the count summed both. That is reachable
 * through the product, not just the importer, because the panel lets someone choose the
 * kind and type the label independently — so "Dock maintenance" entered as an event
 * merged with the imported closures and the group was labelled one or the other.
 */
function groupKeyFor(hit: SearchHit): string {
  if (hit.vesselId) return `v:${hit.vesselId}`;
  return `l:${hit.kind}:${normalizeQuery(hit.label).toUpperCase()}`;
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
  const [startYear, startMonth, startDay] = startDate.split('-');
  const [endYear, endMonth, endDay] = endDate.split('-');
  const from = `${monthAbbr(startMonth)} ${Number(startDay)}`;
  if (startDate === endDate) return from;
  /*
    The YEAR is compared too, and leaving it out was a real bug rather than an omission.

    This asked only whether the month numbers matched, so any span whose ends share a
    month number but not a year collapsed into one month: `2026-10-01` to `2029-10-31`
    read `Oct 1 – 31`, and `2026-09-23` to `2027-09-24` — a 367-day stay — read
    `Sep 23 – 24`. Over 300,000 date pairs in the next seven years hit it.

    It reached two surfaces, and the second is the one that matters: the berth dropdown
    says `taken Oct 1 – 31` for a berth held for three years, which is a false statement
    about availability inside the one control that exists to stop a bad assignment.

    Both years are named when they differ. This function deliberately has no year of its
    own — `/search` states it in a column and `formatSpanFull` appends it — but a span
    that crosses one has to say so, or it describes a different booking.
  */
  if (startYear === endYear) {
    if (startMonth === endMonth) return `${from} – ${Number(endDay)}`;
    return `${from} – ${monthAbbr(endMonth)} ${Number(endDay)}`;
  }
  return `${from} ${startYear} – ${monthAbbr(endMonth)} ${Number(endDay)} ${endYear}`;
}

/**
 * The same span with its year: `Jul 11 2017`, `Jul 6 – 19 2010`, `Dec 28 2004 – Jan 4 2005`.
 *
 * `/search` can leave the year off because its table states it in a column of its own.
 * Review cannot: its rows run from 1997 to 2019 with nothing around them to say which
 * year is meant, so an undated `Jul 11` there is a question, not an answer.
 *
 * It delegates to `formatSpan` rather than re-deriving the month and day, so the two
 * cannot drift; the year is stated once when the span stays inside it, and on both
 * sides when it does not — `Dec 28 – Jan 4` is the one case where a single trailing
 * year would be wrong.
 */
export function formatSpanFull(startDate: string, endDate: string): string {
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  if (startYear === endYear) return `${formatSpan(startDate, endDate)} ${startYear}`;
  return `${formatSpan(startDate, startDate)} ${startYear} – ${formatSpan(endDate, endDate)} ${endYear}`;
}

/**
 * Guarded, because this is reached from `tighten`, which reads a month out of a STORED
 * sentence. A month outside 1–12 indexed past the end of the array and threw a TypeError
 * out of a server component — one malformed row would have taken the whole Review page
 * down rather than rendering one odd date. Nothing writes such a row today; nothing
 * should be able to cost a page either.
 */
function monthAbbr(month: string): string {
  return MONTH_NAMES[Number(month) - 1]?.slice(0, 3) ?? month;
}

/** The board link that lands on a booking's own month with the booking selected. */
export function hitHref(hit: SearchHit): string {
  const year = Number(hit.startDate.slice(0, 4));
  const month = Number(hit.startDate.slice(5, 7));
  return `/?y=${year}&m=${month}&sel=${hit.id}`;
}
