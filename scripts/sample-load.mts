/**
 * Put the sample back from the seed snapshot, through the same function the "Load the
 * sample schedule" button calls, so the two can never differ. Faster than
 * `npm run import`, which re-parses the workbook, and it needs no workbook on disk.
 *
 * An operator reset, not a user action: it also discards the undo snapshot, so the live
 * site is left with no "put back" offer pointing at whatever was there before.
 */
process.loadEnvFile('.env.local');
const { resetToImported, discardPreviousSchedule } = await import('../src/db/mutations');
const res = await resetToImported();
if (res.ok) await discardPreviousSchedule();
console.log(res.ok ? 'sample loaded' : `failed: ${res.error}`);
await globalThis.__berthSql?.end();
process.exitCode = res.ok ? 0 : 1;
