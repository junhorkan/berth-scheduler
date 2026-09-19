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
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
