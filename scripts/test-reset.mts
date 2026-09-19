import { readFileSync } from 'node:fs';
process.env.DATABASE_URL ||= readFileSync('.env.local','utf8').match(/DATABASE_URL="([^"]+)"/)![1];
const { resetToImported } = await import('../src/db/mutations');
const { db } = await import('../src/db/client');
const sql = db();

const before = await sql`select count(*)::int n, count(*) filter (where source='manual')::int manual from bookings where status <> 'cancelled'`;
console.log('before reset:', before[0]);

const t = Date.now();
const res = await resetToImported();
console.log('reset:', res, `${Date.now() - t}ms`);

const after = await sql`select count(*)::int n, count(*) filter (where source='manual')::int manual from bookings`;
const [rv] = await sql`select count(*)::int n from review_items`;
const [vs] = await sql`select count(*)::int n from vessels`;
const [bs] = await sql`select count(*)::int n from berths`;
console.log('after reset: bookings', after[0], '| review', rv.n, '| vessels', vs.n, '| berths', bs.n);
await sql.end();
process.exit(0);
