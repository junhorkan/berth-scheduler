import { connect } from './db.mjs';
const sql = connect();
const t = Date.now();
try {
  const [r] = await sql`select 1 as ok`;
  console.log('ping ok', r.ok, `${Date.now() - t}ms`);
  const [c] = await sql`select count(*)::int as n from bookings`;
  console.log('bookings', c.n, `${Date.now() - t}ms total`);
} catch (e) { console.error('ping FAILED:', e.message); process.exitCode = 1; }
finally { await sql.end(); }
