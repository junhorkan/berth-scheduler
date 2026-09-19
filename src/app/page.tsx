import { getSummary } from '../db/queries';

// Always read live data; a cached schedule is a wrong schedule.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSummary();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Harborview Marine Research Center</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Dock Schedule</p>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)' }}>
          Imported from the legacy workbook, {s.firstYear}&ndash;{s.lastYear}.
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {[
              ['Berths', s.berths.toLocaleString()],
              ['Bookings', s.bookings.toLocaleString()],
              ['Vessels', s.vessels.toLocaleString()],
              ['Vessels with a recorded length', `${s.vesselsWithLength} of ${s.vessels}`],
              ['Unresolved historical conflicts', s.unresolvedConflicts.toLocaleString()],
              ['Items needing review', s.openReviewItems.toLocaleString()],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{k}</td>
                <td
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border)',
                    textAlign: 'right',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>
        Board, Vessels and Review are being built.
      </p>
    </main>
  );
}
