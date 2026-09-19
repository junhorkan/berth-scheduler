import { getBerths, getBookingsInRange, getSummary } from '../src/db/queries';
const t = async (label: string, fn: () => Promise<unknown>) => {
  const s = Date.now();
  const r = await fn();
  console.log(`${label}: ${Date.now() - s}ms`, Array.isArray(r) ? `(${r.length} rows)` : '');
  return r;
};
process.env.DATABASE_URL ||= (await import('node:fs')).readFileSync('.env.local','utf8').match(/DATABASE_URL="([^"]+)"/)![1];
await t('getBerths', getBerths);
await t('getBookingsInRange Jul2010', () => getBookingsInRange('2010-07-01', '2010-07-31'));
await t('getSummary', getSummary);
await t('getBerths again (warm)', getBerths);
process.exit(0);
