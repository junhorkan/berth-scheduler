/**
 * Put the sample back from the seed snapshot, through the same function the "Load the
 * sample schedule" button calls, so the two can never differ. Faster than
 * `npm run import`, which re-parses the workbook, and it needs no workbook on disk.
 */
process.loadEnvFile('.env.local');
const { resetToImported } = await import('../src/db/mutations');
const res = await resetToImported();
console.log(res.ok ? 'sample loaded, forward bookings dated from today' : `failed: ${res.error}`);
await globalThis.__berthSql?.end();
process.exitCode = res.ok ? 0 : 1;
