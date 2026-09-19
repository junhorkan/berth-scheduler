import { connect } from './db.mjs';
const sql = connect();
try {
  const [v] = await sql`select current_database() as db, current_user as usr, version() as v`;
  console.log(`connected to ${v.db} as ${v.usr}`);
  console.log(v.v.split(',')[0]);
  const t = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
  console.log('tables:', t.map((x) => x.table_name).join(', '));
  for (const tbl of ['berths', 'vessels', 'bookings', 'review_items']) {
    const [c] = await sql.unsafe(`select count(*)::int as n from ${tbl}`);
    console.log(`  ${tbl}: ${c.n} rows`);
  }
  const [ex] = await sql`
    select conname from pg_constraint where conname = 'bookings_no_overlap'`;
  console.log('exclusion constraint present:', !!ex);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
