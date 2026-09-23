import { db } from '../../../db/client';

/**
 * Keeps the database awake.
 *
 * Supabase pauses a free-tier project after roughly seven days without activity, and a
 * paused database would make this site error for anyone opening the link after a quiet
 * stretch. A single trivial query a day prevents that.
 *
 * Run by Vercel Cron (see vercel.json). It is also safe to hit by hand.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    const sql = db();
    const [row] = await sql`select count(*)::int as bookings from bookings`;
    return Response.json({
      ok: true,
      bookings: row.bookings as number,
      ms: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  } catch (e) {
    /*
      The error is logged, not returned.

      This handed back `e.message` on an unauthenticated GET, and a connection failure
      from postgres.js reads `write ECONNREFUSED <host>:<port>` — the database's address,
      published by the one endpoint documented as safe to hit by hand. `describeDbError`
      exists to stop exactly this on the write paths; this route predates it.
    */
    console.error('[keep-warm]', e);
    return Response.json(
      { ok: false, ms: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
