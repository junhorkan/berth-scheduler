import Nav from '../../components/Nav';
import { ResolveButton } from '../../components/ResolveButton';
import { LoadSampleButton, ClearScheduleButton } from '../../components/SampleData';
import { getReviewItems, getReviewCounts, getMissingLengthSummary } from '../../db/queries';
import { groupReviewItems, describeOccurrences } from '../../lib/review';

export const dynamic = 'force-dynamic';

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

export default async function ReviewPage() {
  const [items, counts, missing] = await Promise.all([
    getReviewItems(), getReviewCounts(), getMissingLengthSummary(),
  ]);
  // Only show a pill for a kind of item that exists. Permanently-zero pills are noise.
  const order = ['conflict', 'too_long', 'unclassified'].filter((t) => (counts[t] ?? 0) > 0);
  // One row per problem, not per affected booking.
  const groups = groupReviewItems(items);

  return (
    <main className="shell">
      <Nav current="review" />

      <div className="toolbar">
        {order.map((t) => (
          <span key={t} className={`pill ${LABEL[t].tone}`}>
            {LABEL[t].title}
            <b>{counts[t] ?? 0}</b>
          </span>
        ))}
        {missing.vessels > 0 && (
          <span className="pill muted">
            No recorded length<b>{missing.vessels}</b>
          </span>
        )}
        <span className="spacer" />
        <LoadSampleButton />
        <ClearScheduleButton />
      </div>

      <div className="board">
        {missing.vessels > 0 && (
          <ul className="queue">
            <li className="muted">
              <div className="qmain">
                <span className="qtitle">No recorded length</span>
                <span className="qtext">
                  {missing.vessels.toLocaleString()} vessel{missing.vessels === 1 ? '' : 's'}
                </span>
                <span className="qdetail">
                  {missing.bookings.toLocaleString()} booking
                  {missing.bookings === 1 ? '' : 's'} cannot be checked against berth length
                  until a length is recorded.
                </span>
                <span className="qmeta">Ordered by bookings blocked on the Vessels tab.</span>
              </div>
              <div className="qact">
                <a className="btn" href="/vessels">Add lengths</a>
              </div>
            </li>
          </ul>
        )}

        {items.length === 0 && missing.vessels === 0 ? (
          <p className="empty">Nothing needs attention.</p>
        ) : items.length === 0 ? null : (
          <ul className="queue">
            {groups.map((group) => {
              const head = group.rows[0];
              const when = describeOccurrences(group);
              return (
                <li key={group.key} className={LABEL[group.type].tone}>
                  <div className="qmain">
                    <span className="qtitle">
                      {LABEL[group.type].title}
                      {group.rows.length > 1 && (
                        <span className="qcount">{group.rows.length}&times;</span>
                      )}
                    </span>
                    {head.rawText && <span className="qtext">{head.rawText}</span>}
                    {head.detail && <span className="qdetail">{head.detail}</span>}
                    <span className="qmeta">
                      {head.berthName && <>{head.berthName}</>}
                      {when && <> &middot; {when}</>}
                      {group.rows.length === 1 && head.importSheet && (
                        <> &middot; from sheet {head.importSheet}, row {head.importRow}, col{' '}
                        {head.importCol}</>
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
        )}
        {items.length >= 200 && (
          <p className="note">Showing the first 200 open items of {Object.values(counts).reduce((a, b) => a + b, 0)}.</p>
        )}
      </div>
    </main>
  );
}
