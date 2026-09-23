/**
 * The app ships with an empty schedule, so the suite makes its own data.
 *
 * One fixture month holding every state the board can draw: a vessel that fits, one
 * that does not, a single-day violation, an unknown length, an event, a closure, and
 * a stay crossing into the next month. Small enough to read, complete enough that no
 * spec needs a second fixture — plus one row in the month BEHIND, because a booking
 * that has ended is read-only and nothing future-dated can prove that (see PAST).
 */
import postgres from 'postgres';
import {
  resetToImported, clearSchedule as clearScheduleInApp, restorePrevious,
  discardPreviousSchedule,
} from '../../src/db/mutations';

function connect() {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  return postgres(process.env.DATABASE_URL!, { prepare: false, ssl: 'require', max: 2 });
}

/** The facility's timezone, matching lib/nav — the board's "today" is resolved there. */
function todayAtFacility(): { year: number; month: number } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/**
 * A date N days before the facility's today, resolved in America/New_York.
 *
 * `Date.now() - 86_400_000` is UTC's yesterday, and after 20:00 Eastern UTC has already
 * rolled over — so UTC-minus-one-day IS the facility's today, and a spec asserting "the
 * past is refused" silently starts asserting that today is refused, which it is not. It
 * passes all afternoon and fails in the evening. Two specs have now written this by hand;
 * it lives here so the third does not.
 *
 * `facilityDaysAgo(0)` is the facility's today, which is what a spec about the boundary
 * between work and record needs: a booking ending today has NOT ended.
 */
export function facilityDaysAgo(n: number): string {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * N days after an ISO date, rolling into the next month rather than clamping.
 *
 * The specs that book from the form's default date — today — used to write their end as
 * `min(day + 2, 28)`, which on the 29th of a month produces an end BEFORE the start: an
 * illegal span, a disabled Save, and a spec that fails three days in thirty for a reason
 * nothing on screen explains. Arithmetic in UTC on a date-only string, like
 * `facilityDaysAgo`, because the input is already the facility's own date.
 */
export function isoPlusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A month three ahead of today, and the one after it.
 *
 * In the future on purpose: a booking cannot be made for a date that has passed, so a
 * fixture in the past could be seeded by SQL but never reproduced through the form —
 * and the specs that create bookings would be exercising a path the app forbids.
 */
function monthsAhead(n: number): { year: number; month: number } {
  const { year, month } = todayAtFacility();
  const zero = (year * 12 + (month - 1)) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

const FIXTURE = monthsAhead(3);
const FOLLOWING = monthsAhead(4);
/**
 * One month BEHIND today, holding a single booking.
 *
 * The rest of the fixture is future-dated on purpose — a booking cannot be made for a
 * past date, so a past fixture could be seeded by SQL but never reproduced through the
 * form. That left the whole suite blind to anything that only happens to a booking
 * already in the past, and a real one got through: `moveBooking` read the stored start
 * with `String(aDate)` and compared "Sat Nov 30 2019 …" against "2026-09-22", so every
 * past booking looked like one that had not started yet and none of them could be
 * moved. 62 specs, all green.
 *
 * So this row is seeded rather than booked. Its purpose has since inverted: a booking
 * that has ended is the record, and the product no longer offers to change it
 * (`src/domain/record.ts`). It exists to be REFUSED — the one row in the fixture that
 * proves the panel drops its form, states the rule, and offers nothing but Close. Every
 * one of the 2,031 imported bookings is in the same position, so this is a stand-in for
 * the whole sample, small enough to assert exactly.
 *
 * Its berth and span are exported because the read-only panel states them, and a spec
 * that reads them back is also the assertion that nothing edited the row.
 */
const PAST = monthsAhead(-1);

export const PAST_HREF = `/?y=${PAST.year}&m=${PAST.month}`;
export const PAST_LABEL = 'R/V Test Ghost of Last Month';
export const PAST_BERTH = 'North Pier East';

export const FIXTURE_YEAR = FIXTURE.year;
export const FIXTURE_MONTH = FIXTURE.month;
export const FIXTURE_HREF = `/?y=${FIXTURE.year}&m=${FIXTURE.month}`;
export const NEXT_MONTH_HREF = `/?y=${FOLLOWING.year}&m=${FOLLOWING.month}`;
/** A month with nothing in it, for asserting the empty board still draws. */
export const EMPTY_MONTH_HREF = `/?y=${monthsAhead(8).year}&m=${monthsAhead(8).month}`;

const d = (day: number, which = FIXTURE) =>
  `${which.year}-${String(which.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The seeded past booking's span, which its read-only panel states back. */
export const PAST_START = d(6, PAST);
export const PAST_END = d(8, PAST);

/** Vessels the fixture books, with the lengths that make the fit check say something. */
const VESSELS = [
  { name: 'R/V Test Harbor',  length: 40 },   // comfortably fits a 90ft berth
  { name: 'R/V Test Tern',    length: 120 },  // 120 in a 75ft berth: 1.6 lanes tall
  { name: 'S/Y Test Beacon',  length: 170 },  // 170 in a 90ft berth, on ONE day
  { name: 'M/V Test Drifter', length: null }, // no length: hatched, unverifiable
  { name: 'M/V Test Crosser', length: null },
  // Stored as OSV; searched as OS/V, to prove the spelling fold reaches the query.
  { name: 'OSV Test Osprey',  length: null },
  // Booked repeatedly, so search has something to group and collapse.
  { name: 'R/V Test Regular', length: null },
];

/** How many bookings the busy vessel gets. Above the per-group display cap of 6. */
export const REGULAR_BOOKING_COUNT = 8;

type Row = {
  vessel: string | null; berth: string; kind: string; label: string;
  start: string; end: string;
};

const BOOKINGS: Row[] = [
  { vessel: 'R/V Test Harbor',  berth: 'South Float West', kind: 'vessel',
    label: 'R/V Test Harbor',  start: d(3),  end: d(9) },
  { vessel: 'R/V Test Tern',    berth: 'North Pier Face',  kind: 'vessel',
    label: 'R/V Test Tern',    start: d(5),  end: d(8) },
  { vessel: 'S/Y Test Beacon',  berth: 'South Float East', kind: 'vessel',
    label: 'S/Y Test Beacon',  start: d(14), end: d(14) },
  // The same oversized vessel in the same berth a second time. One problem, two
  // bookings — the case the review queue has to fold rather than list twice.
  { vessel: 'R/V Test Tern',    berth: 'North Pier Face',  kind: 'vessel',
    label: 'R/V Test Tern',    start: d(20), end: d(22) },
  { vessel: 'M/V Test Drifter', berth: 'North Pier West',  kind: 'vessel',
    label: 'M/V Test Drifter', start: d(2),  end: d(20) },
  { vessel: null, berth: 'North Pier East', kind: 'event',
    label: 'Community sail day', start: d(10), end: d(12) },
  { vessel: null, berth: 'Inner Channel', kind: 'closure',
    label: 'Dock maintenance - restricted access', start: d(16), end: d(18) },
  // Runs off the end of the month, so both months must show a clipped edge.
  { vessel: 'M/V Test Crosser', berth: 'South Float West', kind: 'vessel',
    label: 'M/V Test Crosser', start: d(27), end: d(4, FOLLOWING) },
  { vessel: 'OSV Test Osprey', berth: 'North Pier East', kind: 'vessel',
    label: 'OSV Test Osprey', start: d(20), end: d(23) },
  // Last month. Seeded, never booked — see PAST above.
  { vessel: 'R/V Test Harbor', berth: PAST_BERTH, kind: 'vessel',
    label: PAST_LABEL, start: PAST_START, end: PAST_END },
  // Small craft slips is pooled, so these coexist without tripping the conflict check.
  ...Array.from({ length: REGULAR_BOOKING_COUNT }, (_, i) => ({
    vessel: 'R/V Test Regular',
    berth: 'Small craft slips (institution boats)',
    kind: 'vessel',
    label: 'R/V Test Regular',
    start: d(i + 1),
    end: d(i + 1),
  })),
];

export async function seedFixture(): Promise<void> {
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;

      for (const v of VESSELS) {
        await tx`
          insert into vessels (canonical_name, normalized_name, length_ft, length_source)
          values (${v.name}, ${v.name.toUpperCase()}, ${v.length},
                  ${v.length == null ? null : 'manual'})`;
      }
      for (const b of BOOKINGS) {
        await tx`
          insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date, source)
          select be.id,
                 ${b.vessel ? tx`(select id from vessels where canonical_name = ${b.vessel})` : tx`null::uuid`},
                 ${b.kind}, 'active', ${b.label}, ${b.start}::date, ${b.end}::date, 'manual'
            from berths be where be.name = ${b.berth}`;
      }
      // The fit check only has something to say once a length is on record, so the
      // two oversized vessels produce review items exactly as the app would — including
      // the detail's wording, which is `refreshTooLongItems`'s in src/db/mutations. It used to
      // write feet as `'`, a spelling the app no longer uses anywhere, so the suite was
      // the only thing on the site still saying it.
      await tx`
        insert into review_items (type, booking_id, vessel_id, berth_id, raw_text, detail)
        select 'too_long', b.id, v.id, be.id, v.canonical_name,
               'Vessel is ' || v.length_ft || 'ft'
               || ' but the berth is ' || be.length_ft || 'ft'
               || ' — over by ' || (v.length_ft - be.length_ft) || 'ft'
               || ' (' || b.start_date || '..' || b.end_date || ')'
          from bookings b
          join vessels v on v.id = b.vessel_id
          join berths be on be.id = b.berth_id
         where v.length_ft is not null and be.length_ft is not null
           and v.length_ft > be.length_ft`;
    });
  } finally {
    await sql.end();
  }
}

/*
 * The three schedule replacements, reached the only way that is left.
 *
 * None of them is a UI action any more: replacing everyone's schedule from a public page
 * with no accounts should not be one press away, so Clear and Load and Put back are the
 * command line's (`npm run sample:load`, `npm run import`, `npm run put:back`) and these
 * helpers'. The mutations are unchanged, and the specs below still reach every state the
 * buttons reached — what is gone is only the press, which no visitor can perform.
 */

/**
 * Put the sample back — the state the live site serves.
 *
 * The suite replaces the schedule with its own fixture, so without this it would leave
 * the deployed database empty.
 */
export async function restoreSample(): Promise<void> {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  const res = await resetToImported();
  if (!res.ok) throw new Error(`restoring the sample failed: ${res.error}`);
  // Restoring snapshots what it replaced, which here is the suite's own debris. Leave the
  // live site with no snapshot held that points at test bookings.
  await discardPreviousSchedule();
  await globalThis.__berthSql?.end();
}

/** An empty schedule with the berths intact — what a fresh facility would see. */
export async function clearSchedule(): Promise<void> {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  const res = await clearScheduleInApp();
  if (!res.ok) throw new Error(`clearing the schedule failed: ${res.error}`);
}

/** Replace the schedule with the imported sample, exactly as `npm run sample:load` does. */
export async function loadSample(): Promise<void> {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  const res = await resetToImported();
  if (!res.ok) throw new Error(`loading the sample failed: ${res.error}`);
}

/** Put back whatever the last replacement displaced, as `npm run put:back` does. */
export async function putBackSchedule(): Promise<void> {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  const res = await restorePrevious();
  if (!res.ok) throw new Error(`putting the schedule back failed: ${res.error}`);
}

/**
 * Which action took the snapshot that is held right now, or null if none is.
 *
 * This was readable on the page — the Review footer named it, and a spec read it there to
 * prove a Load over an empty schedule had not overwritten the snapshot of what was there
 * before. The footer is gone with the buttons, and `npm run put:back` is the only reader
 * left, so the specs read the slot itself. The rule it is checking belongs to the
 * mutations (`src/lib/undo.ts`), never to a caption, which is why it survives its own
 * caption's removal.
 */
export async function heldSnapshotKind(): Promise<string | null> {
  const sql = connect();
  try {
    const [row] = await sql`select kind from undo_meta where id = 1`;
    return row ? (row.kind as string) : null;
  } finally {
    await sql.end();
  }
}
