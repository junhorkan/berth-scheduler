/**
 * The app ships with an empty schedule, so the suite makes its own data.
 *
 * One fixture month holding every state the board can draw: a vessel that fits, one
 * that does not, a single-day violation, an unknown length, an event, a closure, and
 * a stay crossing into the next month. Small enough to read, complete enough that no
 * spec needs a second fixture.
 */
import postgres from 'postgres';

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

/** June of the current year: always inside the bookable window, never "today". */
export const FIXTURE_YEAR = todayAtFacility().year;
export const FIXTURE_MONTH = 6;
export const FIXTURE_HREF = `/?y=${FIXTURE_YEAR}&m=${FIXTURE_MONTH}`;
export const NEXT_MONTH_HREF = `/?y=${FIXTURE_YEAR}&m=${FIXTURE_MONTH + 1}`;

const d = (day: number, month = FIXTURE_MONTH) =>
  `${FIXTURE_YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
  { vessel: 'M/V Test Drifter', berth: 'North Pier West',  kind: 'vessel',
    label: 'M/V Test Drifter', start: d(2),  end: d(20) },
  { vessel: null, berth: 'North Pier East', kind: 'event',
    label: 'Community sail day', start: d(10), end: d(12) },
  { vessel: null, berth: 'Inner Channel', kind: 'closure',
    label: 'Dock maintenance - restricted access', start: d(16), end: d(18) },
  // Runs off the end of the month, so both months must show a clipped edge.
  { vessel: 'M/V Test Crosser', berth: 'South Float West', kind: 'vessel',
    label: 'M/V Test Crosser', start: d(27), end: d(4, FIXTURE_MONTH + 1) },
  { vessel: 'OSV Test Osprey', berth: 'North Pier East', kind: 'vessel',
    label: 'OSV Test Osprey', start: d(20), end: d(23) },
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
      // two oversized vessels produce review items exactly as the app would.
      await tx`
        insert into review_items (type, booking_id, vessel_id, berth_id, raw_text, detail)
        select 'too_long', b.id, v.id, be.id, v.canonical_name,
               'Vessel is ' || v.length_ft || '''' || ' but the berth is ' || be.length_ft || ''''
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

/** Back to the state the app ships in: an empty schedule, berths intact. */
export async function clearSchedule(): Promise<void> {
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
    });
  } finally {
    await sql.end();
  }
}
