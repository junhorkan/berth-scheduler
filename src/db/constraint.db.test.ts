/**
 * The guarantee, tested in raw SQL.
 *
 * Every other test in this repository is pure: no database, no server, no browser.
 * That is the right default and it has one blind spot, which is the centrepiece of the
 * whole design. `src/domain/conflicts.ts` is the application's *mirror* of the rule —
 * and [DECISIONS 1](../../DECISIONS.md) argues that an application-level check is only
 * as good as every code path that ever touches the table. Verifying the mirror
 * therefore proves nothing about the constraint.
 *
 * So this file talks to Postgres and nothing else. No React, no server actions, no
 * queries.ts, no mutations.ts — `insert` and `update` statements, and the verdict
 * Postgres gives back. If the application disappeared tomorrow, these are the promises
 * the database would still keep.
 *
 *   EXCLUDE USING gist (berth_id WITH =, during WITH &&)
 *     WHERE (status = 'active' AND exclusive)
 *
 * NOTHING IS EVER COMMITTED. Every case runs inside one transaction that ends in a
 * deliberate rollback, and each statement expected to fail runs inside a SAVEPOINT —
 * a constraint violation aborts the surrounding transaction, so without one the first
 * refusal would poison every assertion after it.
 *
 * Not part of `npm test`, on purpose: that command promises no database, and a fresh
 * clone with no credentials must stay green. `npm run test:db` runs this.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile('.env.local'); } catch { /* no local env; the suite skips */ }
}
const URL = process.env.DATABASE_URL;

/** Postgres' exclusion-violation SQLSTATE. The refusal this project is built on. */
const EXCLUSION_VIOLATION = '23P01';
/** Raised by `daterange()` itself when the bounds are inverted — see the case below. */
const DATA_EXCEPTION = '22000';

/**
 * Far enough out that a leak could not collide with a real booking — the schedule runs
 * 1997–2019 and the app refuses to write past `currentYear + 3`. If one of these ever
 * appears on the board, the rollback below failed and that is worth noticing loudly.
 */
const Y = 2099;
const d = (day: number) => `${Y}-03-${String(day).padStart(2, '0')}`;

describe.skipIf(!URL)('the exclusion constraint, in SQL', () => {
  let sql: ReturnType<typeof postgres>;
  let exclusiveBerth: string;
  let otherBerth: string;
  let pooledBerth: string;
  let vessel: string;

  beforeAll(async () => {
    // Same connection shape the app uses: Supabase's transaction pooler refuses
    // prepared statements, and `max: 1` keeps every statement on one session so a
    // savepoint means what it says.
    sql = postgres(URL!, { prepare: false, ssl: 'require', max: 1 });
    const berths = await sql`
      select id, capacity_mode from berths order by display_order`;
    exclusiveBerth = berths.find((b) => b.capacity_mode === 'exclusive')!.id as string;
    otherBerth = berths.filter((b) => b.capacity_mode === 'exclusive')[1]!.id as string;
    pooledBerth = berths.find((b) => b.capacity_mode === 'pooled')!.id as string;
    const [v] = await sql`select id from vessels limit 1`;
    vessel = v.id as string;
  });

  afterAll(async () => { await sql?.end(); });

  /**
   * One transaction, always rolled back.
   *
   * `sql.begin` rolls back when its callback throws, so the sentinel is how the work
   * is undone: the test body runs, its assertions are made, and then the transaction
   * is discarded whatever happened. A `finally` would not do — the rollback has to be
   * the normal exit, not the exceptional one.
   */
  const ROLLBACK = Symbol('rollback');
  async function inRolledBackTx(body: (tx: postgres.TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await body(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }

  type Row = {
    berth?: string; start: string; end: string;
    status?: string; kind?: string; label?: string; vesselId?: string | null;
  };

  const insert = (tx: postgres.TransactionSql, r: Row) => tx`
    insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date)
    values (${r.berth ?? exclusiveBerth},
            ${r.vesselId === undefined ? vessel : r.vesselId},
            ${r.kind ?? 'vessel'}, ${r.status ?? 'active'},
            ${r.label ?? `SQL constraint test ${randomUUID().slice(0, 8)}`},
            ${r.start}, ${r.end})
    returning id`;

  /**
   * Run a statement that is expected to be refused, and return its SQLSTATE.
   *
   * The savepoint is load-bearing: a failed statement aborts its transaction, and
   * every later statement would answer `25P02 current transaction is aborted` instead
   * of the verdict being asked for. Rolling back to the savepoint puts the transaction
   * back on its feet, so one file can test eleven refusals.
   */
  async function refusedCode(
    tx: postgres.TransactionSql, run: (sp: postgres.TransactionSql) => Promise<unknown>,
  ): Promise<string | null> {
    try {
      await tx.savepoint(async (sp) => { await run(sp); });
      return null;                       // it was accepted
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }

  it('refuses a second active booking overlapping the first on one berth', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(14) });
      const code = await refusedCode(tx, (sp) => insert(sp, { start: d(12), end: d(16) }));
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('accepts bookings that merely touch end to end', async () => {
    // Mon–Tue then Wed–Thu. Adjacent is not overlapping, and a constraint that refused
    // this would make back-to-back visits impossible.
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(11) });
      const code = await refusedCode(tx, (sp) => insert(sp, { start: d(12), end: d(13) }));
      expect(code).toBeNull();
    });
  });

  /**
   * The one that proves the generated column. `during` is
   * `daterange(start_date, end_date + 1, '[)')`, so an inclusive end really is
   * inclusive: a stay ending Wednesday and one starting Wednesday both hold Wednesday.
   * Stored as `[start, end)` without the +1, this case would pass and the board would
   * be wrong about every handover day.
   */
  it('refuses a same-day handover, because the end date is inclusive', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(12) });
      const code = await refusedCode(tx, (sp) => insert(sp, { start: d(12), end: d(14) }));
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('exempts a pooled berth, where several boats share the water', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { berth: pooledBerth, start: d(10), end: d(14) });
      const code = await refusedCode(tx, (sp) =>
        insert(sp, { berth: pooledBerth, start: d(10), end: d(14) }));
      expect(code).toBeNull();
    });
  });

  it('leaves the same days free on a different berth', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(14) });
      const code = await refusedCode(tx, (sp) =>
        insert(sp, { berth: otherBerth, start: d(10), end: d(14) }));
      expect(code).toBeNull();
    });
  });

  it('frees the slot when a booking is cancelled, because the constraint is partial', async () => {
    // `WHERE (status = 'active' ...)` is what makes cancelling a soft delete that
    // actually releases the berth, rather than a row that still blocks it.
    await inRolledBackTx(async (tx) => {
      const [held] = await insert(tx, { start: d(10), end: d(14) });
      let code = await refusedCode(tx, (sp) => insert(sp, { start: d(11), end: d(12) }));
      expect(code).toBe(EXCLUSION_VIOLATION);

      await tx`update bookings set status = 'cancelled' where id = ${held.id}`;
      code = await refusedCode(tx, (sp) => insert(sp, { start: d(11), end: d(12) }));
      expect(code).toBeNull();
    });
  });

  /**
   * The seam that lets the importer keep the facility's one real double-booking.
   * `conflict_unresolved` sits outside the constraint's WHERE, so history loads intact
   * — and the moment such a row is restored to 'active' the constraint judges it again.
   */
  it('lets an imported conflict exist as conflict_unresolved, and refuses it when made active', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(14) });
      const [kept] = await insert(tx, { start: d(11), end: d(12), status: 'conflict_unresolved' });
      expect(kept.id).toBeTruthy();

      const code = await refusedCode(tx, (sp) =>
        sp`update bookings set status = 'active' where id = ${kept.id}`);
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('treats a closure as occupying the berth against a vessel', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { kind: 'closure', vesselId: null, start: d(10), end: d(14) });
      const code = await refusedCode(tx, (sp) => insert(sp, { start: d(12), end: d(13) }));
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('refuses a MOVE onto an occupied berth, not only an insert', async () => {
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(14) });
      const [mover] = await insert(tx, { berth: otherBerth, start: d(10), end: d(14) });
      const code = await refusedCode(tx, (sp) =>
        sp`update bookings set berth_id = ${exclusiveBerth} where id = ${mover.id}`);
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('refuses a DATE change that creates an overlap, through the generated column', async () => {
    // Nothing writes `during`; it is recomputed from the two dates on every update,
    // which is why moving a booking in time is judged exactly like moving it in space.
    await inRolledBackTx(async (tx) => {
      await insert(tx, { start: d(10), end: d(14) });
      const [mover] = await insert(tx, { start: d(20), end: d(21) });
      const code = await refusedCode(tx, (sp) =>
        sp`update bookings set start_date = ${d(13)}, end_date = ${d(15)} where id = ${mover.id}`);
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('refuses two overlapping rows inserted by a single statement', async () => {
    // The race the whole design exists to close, in its purest form: no application
    // code between the two rows at all, so no check-then-insert window could help.
    await inRolledBackTx(async (tx) => {
      const code = await refusedCode(tx, (sp) => sp`
        insert into bookings (berth_id, vessel_id, kind, status, label, start_date, end_date)
        values (${exclusiveBerth}, ${vessel}, 'vessel', 'active', 'SQL bulk a', ${d(10)}, ${d(14)}),
               (${exclusiveBerth}, ${vessel}, 'vessel', 'active', 'SQL bulk b', ${d(12)}, ${d(16)})`);
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  it('keeps `exclusive` truthful by trigger when a booking moves to a pooled berth', async () => {
    // `exclusive` is denormalised because an exclusion constraint cannot join to
    // another table. If the trigger missed an UPDATE, a booking moved onto a pooled
    // berth would keep blocking it — or worse, one moved off a pooled berth would not.
    await inRolledBackTx(async (tx) => {
      const [b] = await insert(tx, { berth: pooledBerth, start: d(10), end: d(14) });
      const [before] = await tx`select exclusive from bookings where id = ${b.id}`;
      expect(before.exclusive).toBe(false);

      await tx`update bookings set berth_id = ${exclusiveBerth} where id = ${b.id}`;
      const [after] = await tx`select exclusive from bookings where id = ${b.id}`;
      expect(after.exclusive).toBe(true);
    });
  });

  /**
   * An end before its start is refused — but NOT by the CHECK constraint written for it.
   *
   * `during` is a generated column, and `daterange(start, end + 1)` is evaluated before
   * any CHECK runs. An inverted range makes that function throw `22000` outright, so
   * `end_not_before_start` never gets a chance to speak. The CHECK is not dead weight —
   * it is the backstop if `during` is ever changed or dropped — but the error a caller
   * actually sees is the data exception, which is why `describeDbError` handles 22000
   * and not only 23514. Asserting the CHECK's code here would have documented a code
   * path the database does not take.
   */
  it('refuses an end date before its start, from the generated range not the CHECK', async () => {
    await inRolledBackTx(async (tx) => {
      const code = await refusedCode(tx, (sp) => insert(sp, { start: d(14), end: d(10) }));
      expect(code).toBe(DATA_EXCEPTION);
    });
  });

  it('still carries the CHECK behind it, and the exclusion constraint itself', async () => {
    const rows = await sql`
      select conname from pg_constraint
       where conname in ('bookings_no_overlap', 'end_not_before_start',
                         'vessel_required_for_vessel_kind')`;
    expect(rows.map((r) => r.conname).sort())
      .toEqual(['bookings_no_overlap', 'end_not_before_start', 'vessel_required_for_vessel_kind']);
  });

  it('leaves nothing behind: every row above was rolled back', async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from bookings where start_date >= ${`${Y}-01-01`}`;
    expect(n).toBe(0);
  });
});
