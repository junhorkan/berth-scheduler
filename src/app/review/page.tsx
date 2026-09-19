import Nav from '../../components/Nav';
import { ResolveButton, ResetButton } from '../../components/ResolveButton';
import { getReviewItems, getReviewCounts } from '../../db/queries';

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
  missing_length: {
    title: 'No recorded length',
    blurb: 'Fit cannot be verified until a length is recorded on the Vessels tab.',
    tone: 'muted',
  },
};

export default async function ReviewPage() {
  const [items, counts] = await Promise.all([getReviewItems(), getReviewCounts()]);
  const order = ['conflict', 'too_long', 'unclassified', 'missing_length'];

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
        <span className="spacer" />
        <ResetButton />
      </div>

      <div className="board">
        {items.length === 0 ? (
          <p className="empty">Nothing needs attention.</p>
        ) : (
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
                  {r.type === 'missing_length' ? (
                    <a className="btn" href="/vessels">Add length</a>
                  ) : r.bookingStart ? (
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
