import Nav from '../../components/Nav';
import { ResolveButton } from '../../components/ResolveButton';
import { LoadSampleButton, ClearScheduleButton, RestorePreviousButton } from '../../components/SampleData';
import {
  getReviewItems, getMissingLengthSummary, getRecentlyCancelled, getPreviousSchedule,
} from '../../db/queries';
import type { ReviewRow } from '../../db/queries';
import { groupReviewItems, describeOccurrences } from '../../lib/review';
import type { ReviewGroup } from '../../lib/review';
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
 * Rows shown per section before the rest fold behind "Show the remaining N". The same
 * rule as the Vessels register: a long list shows its head, and the tail is one click
 * away rather than a screen of scrolling (DECISIONS 23).
 */
const HEAD = 5;

/**
 * The stored detail ends with the span in brackets — `... over by 45'. (2006-02-04..
 * 2006-02-04)` — which the meta line underneath already states. Display concern only;
 * the text in the database is left exactly as the importer wrote it.
 */
function tighten(detail: string): string {
  return detail.replace(/\s*\(\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}\)\s*$/, '');
}

export default async function ReviewPage() {
  const [items, missing, cancelled, undo] = await Promise.all([
    getReviewItems(), getMissingLengthSummary(), getRecentlyCancelled(), getPreviousSchedule(),
  ]);

  /*
    A work queue holds work. Of the 30 items the 23-year import produced, one was about
    a booking that had not happened yet; the rest were bookings that ended between 2006
    and 2017, and cells from sheets going back to 2001. Nobody can move a vessel that
    sailed nine years ago, and a queue mostly full of those teaches people to stop
    reading it.

    So the split is by whether anything can still be done, not by how bad it is. What is
    deleted: nothing. The history is the evidence that the import dropped nothing
    silently (invariant 3), and it keeps its counts and its buttons — it just stops
    calling itself a decision.
  */
  const current = items.filter((i) => i.isCurrent);
  const historical = items.filter((i) => !i.isCurrent);
  const open = current.length;

  // One row per problem, not per affected booking; and one HEADING per kind of problem,
  // rather than the type printed on every row beneath it.
  const sectionsFor = (rows: typeof items) => {
    const groups = groupReviewItems(rows);
    return ['conflict', 'too_long', 'unclassified']
      .map((type) => ({ type, groups: groups.filter((g) => g.type === type) }))
      .filter((s) => s.groups.length > 0);
  };
  const currentSections = sectionsFor(current);
  const historySections = sectionsFor(historical);

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
          ? 'Nothing on the schedule needs a decision.'
          : <>
              <b>{open} item{open === 1 ? '' : 's'} need{open === 1 ? 's' : ''} a decision.</b>{' '}
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
        ) : currentSections.length === 0 ? (
          <p className="empty">Nothing on the schedule needs a decision.</p>
        ) : (
          currentSections.map(({ type, groups: rows }) => {
            const head = rows.slice(0, HEAD);
            const tail = rows.slice(HEAD);
            return (
              <section key={type} className="qsection">
                {/* Stated once, with its count, instead of on every row beneath it. */}
                <h2 className={`qhead ${LABEL[type].tone}`}>
                  {LABEL[type].title}
                  <span className="qhcount">
                    {rows.reduce((a, g) => a + g.rows.length, 0)}
                  </span>
                </h2>
                <ul className="queue">
                  {head.map((group) => <Row key={group.key} type={type} group={group} />)}
                </ul>
                {tail.length > 0 && (
                  // Native <details>, like the board's rules: no JavaScript, and the
                  // page stays a server component.
                  <details className="qmore">
                    <summary>
                      <span className="when-closed">Show the remaining {tail.length}</span>
                      <span className="when-open">Show fewer</span>
                    </summary>
                    <ul className="queue">
                      {tail.map((group) => <Row key={group.key} type={type} group={group} />)}
                    </ul>
                  </details>
                )}
              </section>
            );
          })
        )}

        {items.length >= 200 && (
          <p className="note">Showing the first 200 open items.</p>
        )}
      </div>

      {/*
        Everything the import turned up that nobody can act on any more. It keeps its
        counts, its groupings and its buttons; what it loses is the claim that it is
        pending work. Deleting it instead would answer "what happened to the cells you
        could not parse?" with "gone", which is the one answer this project does not give.
      */}
      {historical.length > 0 && (
        <div className="board history">
          <h2 className="cardtitle">From the imported history</h2>
          <p className="note">
            {historical.length} item{historical.length === 1 ? '' : 's'} from the 23-year
            import: bookings that have already ended, and cells the importer could not
            read. Kept as the record that nothing was dropped silently.
          </p>
          {historySections.map(({ type, groups: rows }) => {
            const head = rows.slice(0, HEAD);
            const tail = rows.slice(HEAD);
            return (
              <section key={type} className="qsection">
                <h2 className={`qhead ${LABEL[type].tone}`}>
                  {LABEL[type].title}
                  <span className="qhcount">
                    {rows.reduce((a, g) => a + g.rows.length, 0)}
                  </span>
                </h2>
                <ul className="queue">
                  {head.map((group) => <Row key={group.key} type={type} group={group} />)}
                </ul>
                {tail.length > 0 && (
                  <details className="qmore">
                    <summary>
                      <span className="when-closed">Show the remaining {tail.length}</span>
                      <span className="when-open">Show fewer</span>
                    </summary>
                    <ul className="queue">
                      {tail.map((group) => <Row key={group.key} type={type} group={group} />)}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

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
        {undo && (
          <RestorePreviousButton
            bookings={undo.bookings}
            vessels={undo.vessels}
            kind={undo.kind}
            when={relativeTime(undo.takenAt)}
          />
        )}
        <span className="sub-hint">
          The sample is the 23-year legacy workbook, as imported. Loading and clearing
          each replace the whole schedule, and either can be put back afterwards. The
          seven berths always stay: they are the facility, not schedule data.
        </span>
      </div>
    </main>
  );
}

/**
 * One problem, one row, one decision.
 *
 * Two lines for a cell nobody could read — what it said, and where it was — and three
 * for a conflict or a misfit: what it said, the measurement, and the berth and dates.
 * "Show on board" is navigation, not a decision, so it is a link and not a second
 * bordered button; "Mark done" is the row's one button.
 */
function Row({ type, group }: { type: string; group: ReviewGroup<ReviewRow> }) {
  const head = group.rows[0];
  const when = describeOccurrences(group);
  // Where it came from in the workbook, but only for the cells nobody could classify —
  // those are the ones you resolve by going and looking at the sheet. A conflict or a
  // misfit is on the board, where the provenance tells you nothing you can act on.
  const provenance =
    type === 'unclassified' && group.rows.length === 1 && head.importSheet
      ? `sheet ${head.importSheet}, row ${head.importRow}, col ${head.importCol}`
      : null;
  const meta =
    type === 'unclassified' ? null : [head.berthName, when].filter(Boolean).join(' · ');

  return (
    <li>
      <div className="qmain">
        <span className="qtext">
          {head.rawText ?? LABEL[type].title}
          {group.rows.length > 1 && (
            <span className="qcount">{group.rows.length}&times;</span>
          )}
        </span>
        {head.detail && (
          <span className="qdetail">
            {tighten(head.detail)}
            {provenance && <> &middot; {provenance}</>}
          </span>
        )}
        {meta && <span className="qmeta">{meta}</span>}
      </div>
      <div className="qact">
        {head.bookingStart && (
          <a
            className="qlink"
            href={`/?y=${head.bookingStart.slice(0, 4)}&m=${Number(head.bookingStart.slice(5, 7))}&sel=${head.bookingId ?? ''}`}
          >
            Show on board &rarr;
          </a>
        )}
        <ResolveButton ids={group.ids} />
      </div>
    </li>
  );
}
