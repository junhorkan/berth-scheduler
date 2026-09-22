/**
 * Import the legacy workbook into the live database, and make it the new sample.
 *
 *   npm run import                     # the workbook in data/
 *   npm run import -- path/to/any.xlsx
 *
 * Parses first, with the same planner the dry run and the in-browser check use, so a
 * file that is empty, damaged, or not a schedule is refused before anything is written.
 * Then one transaction: it replaces the schedule under the same lock and undo rule as
 * "Load the sample", maps every row onto the facility's own berths, and rewrites the
 * seed tables. If any step fails, nothing changes. See writeImportPlan.
 *
 * `npm run import:check` prints the same report without touching the database.
 */
process.loadEnvFile('.env.local');
const { planImport, ImportError } = await import('../src/import/plan');
const { readBytes } = await import('../src/import/fromFile');
const { formatReconciliation } = await import('../src/import/report');
const { writeImportPlan } = await import('../src/db/mutations');

const path = process.argv[2] ?? 'data/Dock Schedule - Synthetic Sample.xlsx';
let plan;
try {
  plan = await planImport(readBytes(path));
} catch (e) {
  if (e instanceof ImportError) { console.error(`\nRefused: ${e.message}\nNothing was written.\n`); process.exit(1); }
  throw e;
}

console.log(`\n${path}\n`);
console.log(formatReconciliation(plan.reconciliation));
const res = await writeImportPlan(plan);
await globalThis.__berthSql?.end();
if (!res.ok) { console.error(`\nImport failed, and was rolled back: ${res.error}\n`); process.exit(1); }
console.log(`\nImported ${res.bookings.toLocaleString()} bookings, ${res.vessels} vessels and ${res.reviewItems} review items, and saved them as the sample.\n`);
