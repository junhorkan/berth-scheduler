/**
 * The dry run: parse a workbook and print what an import would do, touching nothing.
 *
 *   npm run import:check                    # the workbook in data/
 *   npm run import:check -- path/to/any.xlsx
 *
 * Needs no database and no .env. Point it at an edited copy — a second double-booking
 * planted, a vessel's length changed — and it reports what it finds. The unit tests
 * lock the real workbook's counts; this is for any other file, which a test cannot be.
 */
import { planImport, ImportError } from '../src/import/plan';
import { readBytes } from '../src/import/fromFile';
import { formatReconciliation } from '../src/import/report';

const path = process.argv[2] ?? 'data/Dock Schedule - Synthetic Sample.xlsx';
try {
  const plan = planImport(readBytes(path));
  console.log(`\n${path}\n`);
  console.log(formatReconciliation(plan.reconciliation));
  console.log('\nNothing was written.\n');
} catch (e) {
  if (e instanceof ImportError) { console.error(`\nRefused: ${e.message}\n`); process.exit(1); }
  if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error(`\nNo file at ${path}. The workbook is the client's and is not in the repository;\nput your copy there, or pass a path.\n`);
    process.exit(1);
  }
  throw e;
}
