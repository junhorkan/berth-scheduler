import Nav from '../../components/Nav';
import VesselLengthInput from '../../components/VesselLengthInput';
import { getVessels } from '../../db/queries';

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();
  const missing = vessels.filter((v) => v.lengthFt == null);
  const totalBookings = vessels.reduce((a, v) => a + v.bookingCount, 0);
  const blocked = missing.reduce((a, v) => a + v.bookingCount, 0);

  // How many bookings the next N entries would unlock — the argument for the sort order.
  const cum = (n: number) =>
    missing.slice(0, n).reduce((a, v) => a + v.bookingCount, 0);

  return (
    <main className="shell">
      <Nav current="vessels" />

      <div className="panel">
        <p style={{ margin: 0 }}>
          <b>{missing.length} of {vessels.length} vessels have no recorded length</b>, so{' '}
          {blocked.toLocaleString()} of {totalBookings.toLocaleString()} bookings cannot be checked
          against berth length.
        </p>
        <p className="note" style={{ marginTop: 6 }}>
          Bookings are heavily concentrated, so this is far less work than it looks. Recording just
          the first <b>{Math.min(10, missing.length)}</b> lengths below would make{' '}
          <b>{cum(10).toLocaleString()}</b> bookings verifiable
          {totalBookings > 0 && <> — {Math.round((cum(10) / totalBookings) * 100)}% of the schedule</>}.
          That is why this list is ordered by bookings blocked, not alphabetically.
        </p>
      </div>

      <div className="board" style={{ marginTop: 12 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Vessel</th>
              <th style={{ width: 120 }}>Length</th>
              <th style={{ width: 110, textAlign: 'right' }}>Bookings</th>
              <th style={{ width: 110 }}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.canonicalName}
                  {v.operator && <span className="sub-note">{v.operator}</span>}
                  {v.loaFt != null && v.lengthFt != null && v.loaFt !== v.lengthFt && (
                    <span className="flag" title="The source states two different lengths for this vessel. Both are kept; neither is silently chosen.">
                      source also says LOA {v.loaFt}&prime;
                    </span>
                  )}
                </td>
                <td>
                  <VesselLengthInput vesselId={v.id} lengthFt={v.lengthFt} bookingCount={v.bookingCount} />
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{v.bookingCount}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
                  {v.lastSeen ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
