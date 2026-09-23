import Nav from '../../components/Nav';
import { ResolveButton } from '../../components/ResolveButton';
import { LoadSampleButton, RestorePreviousButton } from '../../components/SampleData';
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
 * away rather than a screen of scrolling (ENGINEERING-LOG 23).
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
        The page's one line says what the page is FOR, the way every other masthead
        does. It used to report state — "Nothing on the schedule needs a decision." —
        which reads, on the front door, as "this page has no reason to exist". The
        state belongs in the card below, against the row it is the state of.
      */}
      <Nav
        current="review"
        title="Review"
        tagline="Problems with the schedule, and what to do about them."
      />

      {/*
        One card, one named row per job this page does, each with its count and its
        verb — and each drawn whether or not it has anything in it. A row reading
        "Cancelled bookings · 0 · anything you cancel comes back here" is the page
        explaining itself; the same row deleted is a page that looks broken.

        The card used to disappear entirely when there was no work, which on the
        sample is always: every problem the import found dates from 2001–2017, so the
        queue is empty by construction and the page rendered as a masthead and a
        footer. DECISIONS 26.
      */}
      <div className="board">
        {/*
          When there is work, its own categories head it — "Unresolved conflict · 1"
          says more than "Needs a decision · 1". When there is none, one row stands in
          for all three and says what would appear there.
        */}
        {currentSections.length > 0 ? (
          currentSections.map(({ type, groups }) => (
            <QueueSection key={type} type={type} groups={groups} />
          ))
        ) : (
          <section className="qsection">
            <h2 className="qhead muted">
              Needs a decision
              <span className="qhcount">0</span>
            </h2>
            <p className="qempty">Nothing right now.</p>
          </section>
        )}

        {/*
          Not a review item: a length is missing on most vessels, and that is expected
          (invariant 2). It is here as a pointer to where the work is, with its count,
          and no sentence explaining the arithmetic — the Vessels page does that.
        */}
        <section className="qsection">
          <h2 className="qhead muted">
            No recorded length
            <span className="qhcount">{missing.vessels.toLocaleString()}</span>
            {missing.vessels > 0 && (
              <a className="qlink qheadlink" href="/vessels">Add lengths &rarr;</a>
            )}
          </h2>
          {/* True of a schedule where every length is recorded AND of an empty one. */}
          {missing.vessels === 0 && <p className="qempty">None missing.</p>}
        </section>

        {/*
          Anyone can cancel anything here, because there are no accounts. Rather than
          restricting the action, it is reversible: a cancel is a soft delete, so undoing
          one is a status change. Restoring re-runs the EXCLUDE constraint, so a slot
          taken in the meantime refuses the restore — which is the correct answer.

          It was its own card below the queue; as a row in the queue it says the same
          thing and, at zero, says the thing worth knowing before you cancel anything.
          It still must not reach the nav badge: a cancellation is not an open problem.
        */}
        <section className="qsection undo">
          <h2 className="qhead muted">
            Cancelled bookings
            <span className="qhcount">{cancelled.length}</span>
          </h2>
          {cancelled.length === 0 ? (
            <p className="qempty">None. A booking you cancel comes back here.</p>
          ) : (
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
          )}
        </section>
      </div>

      {/*
        Everything the import turned up that nobody can act on any more. Nothing is
        deleted to get it here: it keeps its groupings, its counts and its buttons, and
        loses only the claim that it is pending work. Deleting it instead would answer
        "what happened to the cells you could not parse?" with "gone", which is the one
        answer this project does not give.

        It opens on request, one category at a time, and starts closed. Whoever is
        looking at Review came for the work above; the archive is for the question
        "what did the import make of X", which is asked about one kind of thing at a
        time. DECISIONS 26.
      */}
      {historical.length > 0 && (
        <div className="board history">
          <h2 className="cardtitle">History</h2>
          {/* Bookings that have already ended — kept, never deleted. */}
          <p className="qempty">From bookings that have already ended.</p>
          {/*
            Radios and labels, not JavaScript: pressing a button shows that list and
            closes the others, and the page stays a server component like the rest of
            Review. The CSS is in globals.css under "History".
          */}
          <div className="histswitch">
            <div className="catrow" role="radiogroup" aria-label="History category">
              {historySections.map(({ type }) => (
                <label key={type} className="catbtn">
                  <input type="radio" name="hcat" id={`h-${type}`} />
                  {LABEL[type].title}
                </label>
              ))}
              {/*
                Nothing is checked to begin with, which is what makes the card open
                closed — and what keeps it reachable. A checked radio is the group's
                only tab stop, so checking this one, whose label is out of the way until
                there is something to close, skipped the whole switch on the keyboard.
              */}
              <label className="histhide">
                <input type="radio" name="hcat" id="h-none" />
                Hide
              </label>
            </div>
            {historySections.map(({ type, groups }) => (
              <div key={type} className="histpanel" data-cat={type}>
                <QueueSection type={type} groups={groups} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        The query stops at 200 open items, and what it drops can fall in either card, so
        the note sits below both, and whether or not the work card is drawn.
      */}
      {items.length >= 200 && (
        <p className="note">Showing the first 200 open items.</p>
      )}

      {/*
        One control, at the foot and outside the cards: it replaces everything above
        rather than acting on any one row of it. A third card, with a title and a
        paragraph, made the page read as three things competing — Board and Vessels are
        each one card and a line.

        There was a second button here, "Clear the schedule", and it is gone. It existed
        to demonstrate that an empty schedule is supported (invariant 8) — but the front
        door already demonstrates that: every booking in the supplied workbook ended in
        2019, and the board opens on the facility's own month, so the first screen anyone
        sees is an empty one. What the button added was the only way, on a public page
        with no accounts, to delete 23 years of a real schedule in one press. Undoable,
        and still not a thing a berth coordinator does.

        Restoring stays. Without it a visitor who cancels or edits a few bookings has no
        way back to what was here, and the schedule this is loaded with is the facility's
        own record. DECISIONS 26.
      */}
      <div className="sampledata">
        <div className="sampleacts">
          <LoadSampleButton />
          {undo && (
            <RestorePreviousButton
              bookings={undo.bookings}
              vessels={undo.vessels}
              kind={undo.kind}
              when={relativeTime(undo.takenAt)}
            />
          )}
        </div>
        <p className="sub-hint">This replaces every booking, and can be undone.</p>
      </div>
    </main>
  );
}

/**
 * One category: its name and count once, five rows, and the rest behind a fold.
 *
 * The same section in both cards — the work above and the History archive below — so
 * they cannot drift apart. It was written out twice until the archive learned to open
 * one category at a time.
 */
function QueueSection({ type, groups }: { type: string; groups: ReviewGroup<ReviewRow>[] }) {
  const head = groups.slice(0, HEAD);
  const tail = groups.slice(HEAD);
  return (
    <section className="qsection">
      {/* Stated once, with its count, instead of on every row beneath it. */}
      <h2 className={`qhead ${LABEL[type].tone}`}>
        {LABEL[type].title}
        <span className="qhcount">{groups.reduce((a, g) => a + g.rows.length, 0)}</span>
      </h2>
      <ul className="queue">
        {head.map((group) => <Row key={group.key} type={type} group={group} />)}
      </ul>
      {tail.length > 0 && (
        // Native <details>, like the board's rules: no JavaScript, and the page stays
        // a server component.
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
  // Folded or not, every cell keeps its own sheet, row and column (invariant 3); what it
  // said about where it sat is stated once when every occurrence says the same.
  const unread = type === 'unclassified';
  const sameDetail = group.rows.every((r) => r.detail === head.detail);
  const cellOf = (r: ReviewRow) =>
    r.importSheet ? `sheet ${r.importSheet}, row ${r.importRow}, col ${r.importCol}` : null;
  const cells = unread
    ? group.rows
        .map((r) => {
          const c = cellOf(r);
          if (sameDetail) return c;
          return [r.detail && tighten(r.detail), c].filter(Boolean).join(' · ') || null;
        })
        .filter((c): c is string => Boolean(c))
    : [];
  const detail = unread && !sameDetail ? null : head.detail && tighten(head.detail);
  const meta = unread ? null : [head.berthName, when].filter(Boolean).join(' · ');

  return (
    <li>
      <div className="qmain">
        <span className="qtext">
          {head.rawText ?? LABEL[type].title}
          {group.rows.length > 1 && (
            <span className="qcount">{group.rows.length}&times;</span>
          )}
        </span>
        {detail && <span className="qdetail">{detail}</span>}
        {meta && <span className="qmeta">{meta}</span>}
        {cells.map((c, i) => <span key={i} className="qmeta">{c}</span>)}
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
