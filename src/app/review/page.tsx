import Nav from '../../components/Nav';
import { ResolveButton } from '../../components/ResolveButton';
import { ClearScheduleButton } from '../../components/SampleData';
import { getReviewItems, getReviewCounts, getMissingLengthSummary } from '../../db/queries';

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
            {items.map((r) => (
              <li key={r.id} className={LABEL[r.type].tone}>
                <div className="qmain">
                  <span className="qtitle">{LABEL[r.type].title}</span>
                  {r.rawText && <span className="qtext">{r.rawText}</span>}
                  {r.detail && <span className="qdetail">{r.detail}</span>}
                  <span className="qmeta">
                    {r.berthName && <>{r.berthName}</>}
                    {r.bookingStart && <> &middot; {r.bookingStart}</>}
                    {r.importSheet && (
                      <> &middot; from sheet {r.importSheet}, row {r.importRow}, col {r.importCol}</>
                    )}
                  </span>
                </div>
                <div className="qact">
                  {r.bookingStart ? (
                    <a className="btn" href={`/?y=${r.bookingStart.slice(0, 4)}&m=${Number(r.bookingStart.slice(5, 7))}`}>
                      Show on board
                    </a>
                  ) : null}
                  <ResolveButton id={r.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length >= 200 && (
          <p className="note">Showing the first 200 open items of {Object.values(counts).reduce((a, b) => a + b, 0)}.</p>
        )}
      </div>
    </main>
  );
}
