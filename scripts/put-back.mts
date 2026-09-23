/**
 * Put back whatever the last schedule replacement displaced.
 *
 * This was a button on the Review page — the undo for a "restore the original schedule"
 * that landed on top of somebody's work. Both buttons are gone: on a public page with no
 * accounts, replacing everyone's schedule should not be one press away, and the thing
 * they were protecting against is now prevented rather than reversed, since a booking
 * that has ended cannot be edited at all (`src/domain/record.ts`).
 *
 * The mutation is worth keeping and worth reaching. `npm run sample:load` still replaces
 * the live schedule wholesale, and `npm run import` still does after re-parsing the
 * workbook; each one snapshots what it displaced, inside the transaction that displaced
 * it. Without this command that snapshot would be written and never readable — a safety
 * net with nothing on the other end of it.
 *
 * It is a swap, not a one-way restore: what is live now goes into the snapshot slot, so
 * running it twice returns you to where you started, and it can never destroy work. The
 * rule is in `src/lib/undo.ts` and is tested over all 24,576 sequences of up to six
 * actions.
 *
 * It reads `undo_meta` directly rather than through `src/db/queries`, because the query
 * that used to live there existed only to label the button and went with it.
 */
process.loadEnvFile('.env.local');
const { restorePrevious } = await import('../src/db/mutations');
const { db } = await import('../src/db/client');

const sql = db();
const [held] = await sql`select taken_at, bookings, vessels, kind from undo_meta where id = 1`;

if (!held) {
  // Not a failure: the policy only ever holds a schedule worth putting back, so an empty
  // slot means the last replacement had nothing to lose — or there has not been one.
  console.log('Nothing to put back: no snapshot is held.');
} else {
  const n = (v: unknown) => Number(v).toLocaleString();
  console.log(
    `Putting back ${n(held.bookings)} bookings and ${n(held.vessels)} vessels, `
    + `saved ${(held.taken_at as Date).toISOString()} (replaced by: ${held.kind}).`,
  );
  const res = await restorePrevious();
  console.log(res.ok ? 'put back' : `failed: ${res.error}`);
  process.exitCode = res.ok ? 0 : 1;
}

await sql.end();
await globalThis.__berthSql?.end();
