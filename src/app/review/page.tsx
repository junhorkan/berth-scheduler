import Nav from '../../components/Nav';
import { ResolveButton } from '../../components/ResolveButton';
import { LoadSampleButton, ClearScheduleButton } from '../../components/SampleData';
import {
  getReviewItems, getReviewCounts, getMissingLengthSummary, getRecentlyCancelled,
} from '../../db/queries';
import { groupReviewItems, describeOccurrences } from '../../lib/review';
import { relativeTime } from '../../lib/cancelled';
import { RestoreButton } from '../../components/RestoreButton';

export const dynamic = 'force-dynamic';
/**
 * Server Actions inherit this route's function limit, and the sample controls live here.
 * Restoring the workbook deletes and re-inserts 2,031 bookings, 418 vessels and their
 * review items in one transaction, which measured at roughly 12 seconds — past Vercel's
 * 10-second default, where the function is killed mid-transaction and the button simply
 * appears to do nothing.
 */
export const maxDuration = 60;

/**
 * The coordinator's attention queue — deliberately NOT an importer log.
 *
 * Everything the import could not resolve lands here as work with a verb attached,
 * rather than disappearing into a file nobody opens. That is how "nothing vanishes
 * silently" is honoured inside a tool someone would actually use.
 */
const LABEL: Record<string, { title: string; blurb: string; tone: string }> = {
  conflict: {
    title: 'Unresolved conflict',
    blurb: 'Two bookings overlap on one berth. Imported from the legacy schedule, which had no way to express a conflict.',
    tone: 'bad',
  },
  too_long: {
    title: 'Vessel too long for the berth',
    blurb: 'The recorded vessel length exceeds the berth length.',
    tone: 'bad',
  },
  unclassified: {
    title: 'Could not be read',
    blurb: 'A cell the importer would not guess at.',
    tone: 'warn',
  },
};

/**
 * The stored detail ends with the span in brackets — `... over by 45'. (2006-02-04..
 * 2006-02-04)` — which the meta line underneath already states. Display concern only;
 * the text in the database is left exactly as the importer wrote it.
 */
function tighten(detail: string): string {
  return detail.replace(/\s*\(\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}\)\s*$/, '');
}

export default async function ReviewPage() {
  const [items, counts, missing, cancelled] = await Promise.all([
    getReviewItems(), getReviewCounts(), getMissingLengthSummary(), getRecentlyCancelled(),
  ]);
  // Only show a pill for a kind of item that exists. Permanently-zero pills are noise.
  const order = ['conflict', 'too_long', 'unclassified'].filter((t) => (counts[t] ?? 0) > 0);
  // One row per problem, not per affected booking.
  const groups = groupReviewItems(items);
  // ...and one HEADING per kind of problem. The type used to be printed on every row,
  // so "Could not be read" appeared ten times and "Vessel too long" five, to convey
  // two facts. Same rule as the queue folding itself, one level up.
  const sections = order
    .map((type) => ({ type, groups: groups.filter((g) => g.type === type) }))
    .filter((s) => s.groups.length > 0);
  const open = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <main className="shell">
      {/*
        The count is the page's one line, under its name. The pills that used to sit
        here each named a category and gave its count, which every section heading
        below now does a few pixels lower. Clearing goes to the foot of the page — a
        destructive action does not belong in a header, one slip away from the button
        that loads data.
      */}
      <Nav
        current="review"
        title="Review"
        tagline={open === 0
          ? 'Nothing needs a decision.'
          : <>
              <b>{open} item{open === 1 ? '' : 's'} need a decision.</b>{' '}
              Anything the import could not place is here rather than in a log file.
            </>}
      />

      <div className="board">
        {missing.vessels > 0 && (
          <section className="qsection">
            <h2 className="qhead muted">
              No recorded length
              <span className="qhcount">{missing.vessels.toLocaleString()}</span>
            </h2>
            <ul className="queue">
              <li>
                <div className="qmain">
                  <span className="qdetail">
                    {missing.bookings.toLocaleString()} booking
                    {missing.bookings === 1 ? '' : 's'} cannot be checked against berth
                    length until a length is recorded.
                  </span>
                </div>
                <div className="qact">
                  <a className="btn" href="/vessels">Add lengths</a>
                </div>
              </li>
            </ul>
          </section>
        )}

        {items.length === 0 && missing.vessels === 0 ? (
          <p className="empty">Nothing needs attention.</p>
        ) : (
          sections.map(({ type, groups: rows }) => (
            <section key={type} className="qsection">
              {/* Stated once, with its count, instead of on every row beneath it. */}
              <h2 className={`qhead ${LABEL[type].tone}`}>
                {LABEL[type].title}
                <span className="qhcount">{counts[type] ?? rows.length}</span>
              </h2>
              <ul className="queue">
                {rows.map((group) => {
                  const head = group.rows[0];
                  const when = describeOccurrences(group);
                  return (
                    <li key={group.key}>
                      <div className="qmain">
                        <span className="qtext">
                          {head.rawText ?? LABEL[type].title}
                          {group.rows.length > 1 && (
                            <span className="qcount">{group.rows.length}&times;</span>
                          )}
                        </span>
                        {head.detail && <span className="qdetail">{tighten(head.detail)}</span>}
                        <span className="qmeta">
                          {head.berthName && <>{head.berthName}</>}
                          {when && <> &middot; {when}</>}
                          {/*
                            Where it came from in the workbook, but only for the cells
                            nobody could classify — those are the ones you resolve by
                            going and looking at the sheet. A conflict or a misfit is on
                            the board, where the provenance tells you nothing you can act
                            on, so printing it on every row was noise.
                          */}
                          {type === 'unclassified' && group.rows.length === 1 && head.importSheet && (
                            <> &middot; sheet {head.importSheet}, row {head.importRow}, col {head.importCol}</>
                          )}
                        </span>
                      </div>
                      <div className="qact">
                        {head.bookingStart ? (
                          <a
                            className="btn"
                            href={`/?y=${head.bookingStart.slice(0, 4)}&m=${Number(head.bookingStart.slice(5, 7))}&sel=${head.bookingId ?? ''}`}
                          >
                            Show on board
                          </a>
                        ) : null}
                        <ResolveButton ids={group.ids} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        {items.length >= 200 && (
          <p className="note">Showing the first 200 open items of {Object.values(counts).reduce((a, b) => a + b, 0)}.</p>
        )}
      </div>

      {/*
        Anyone can cancel anything here, because there are no accounts. Rather than
        restricting the action, it is reversible: a cancel is a soft delete, so undoing
        one is a status change. Restoring re-runs the EXCLUDE constraint, so a slot
        taken in the meantime refuses the restore — which is the correct answer.

        Deliberately its own card, below the queue, and never a pill in the toolbar:
        a cancellation is not an open problem and must not inflate the nav badge.
      */}
      {cancelled.length > 0 && (
        <div className="board undo">
          <h2 className="cardtitle">Recently cancelled</h2>
          <ul className="queue">
            {cancelled.map((c) => (
              <li key={c.id}>
                <div className="qmain">
                  <span className="qtext">{c.label}</span>
                  <span className="qdetail">
                    {c.berthName} &middot; {c.startDate} to {c.endDate}
                  </span>
                  <span className="qmeta">Cancelled {relativeTime(c.cancelledAt)}</span>
                </div>
                <div className="qact">
                  <RestoreButton id={c.id} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The sample controls, at the foot. Loading is additive and safe; clearing destroys
        everything and is one slip from it, which is why neither belongs in a header
        beside the counts.
      */}
      <div className="sampledata">
        <LoadSampleButton />
        <ClearScheduleButton />
        <span className="sub-hint">
          The sample is 23 years of legacy bookings. Clearing cannot be undone: it
          leaves only the seven berths, which are the facility rather than schedule
          data, and the sample can always be loaded again.
        </span>
      </div>
    </main>
  );
}
