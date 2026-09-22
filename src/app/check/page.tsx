import Nav from '../../components/Nav';
import WorkbookCheck from '../../components/WorkbookCheck';
import { getSample } from '../../db/queries';

export const dynamic = 'force-dynamic';

/**
 * Check a workbook: what the importer makes of a schedule file, with nothing saved.
 *
 * A destination, like /search, not a fourth tab (invariant 9). It is linked from the
 * sample controls on Review, beside the schedule it would be compared with.
 *
 * Read-only on purpose. Importing a file from a public, account-less page would let any
 * visitor replace everyone's schedule; the command-line importer does that job, behind
 * the database credentials. What a visitor can usefully do is see the importer's answer
 * for their own copy of the file — DECISIONS 30.
 */
export default async function CheckPage() {
  const sample = await getSample();
  return (
    <main className="shell">
      <Nav
        current="check"
        title="Check a workbook"
        tagline="See what the importer makes of a schedule workbook."
      />
      <div className="board">
        <WorkbookCheck sample={sample} />
      </div>
    </main>
  );
}
