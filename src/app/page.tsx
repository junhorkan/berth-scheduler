import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { getBerths, getBookingsInRange, getSummary, getVessels, getBookingById } from '../db/queries';
import { monthBounds } from '../lib/layout';
import { clampMonth, monthHref, MONTH_NAMES, step, DEFAULT_MONTH, DEFAULT_YEAR, FIRST_YEAR, LAST_YEAR } from '../lib/nav';

// A cached schedule is a wrong schedule.
export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; sel?: string }>;
}) {
  const sp = await searchParams;
  const { year, month } = clampMonth(
    sp.y ? Number(sp.y) : DEFAULT_YEAR,
    sp.m ? Number(sp.m) : DEFAULT_MONTH,
  );

  const bounds = monthBounds(year, month);
  const [berths, bookings, summary, vessels] = await Promise.all([
    getBerths(),
    getBookingsInRange(bounds.start, bounds.end),
    getSummary(),
    getVessels(),
  ]);

  const selected = sp.sel ? await getBookingById(sp.sel) : null;
  const prev = step(year, month, -1);
  const next = step(year, month, 1);
  const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  return (
    <main className="shell">
      <Nav current="board" />

      <div className="toolbar">
        <a className="navbtn" href={monthHref(prev.year, prev.month)} aria-label="Previous month">&lsaquo;</a>
        <span className="month">{MONTH_NAMES[month - 1]} {year}</span>
        <a className="navbtn" href={monthHref(next.year, next.month)} aria-label="Next month">&rsaquo;</a>

        <form method="get" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label htmlFor="y" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Jump to</label>
          <select id="y" name="y" defaultValue={year} style={selectStyle}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select name="m" defaultValue={month} style={selectStyle}>
            {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <button type="submit" style={buttonStyle}>Go</button>
        </form>

        <span className="spacer" />
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {bookings.length} booking{bookings.length === 1 ? '' : 's'} this month
        </span>
        <BookingPanel
          berths={berths}
          vessels={vessels.map((v) => ({ id: v.id, name: v.canonicalName, lengthFt: v.lengthFt }))}
          defaultDate={bounds.start}
        />
      </div>

      {bookings.length === 0 ? (
        <div className="board"><p className="empty">No bookings in {MONTH_NAMES[month - 1]} {year}.</p></div>
      ) : (
        <Board berths={berths} bookings={bookings} year={year} month={month} selectedId={sp.sel} />
      )}

      {selected && (
        <BookingDetail booking={selected} berths={berths} closeHref={monthHref(year, month)} />
      )}

      <p className="note">
        {summary.vessels - summary.vesselsWithLength} of {summary.vessels} vessels have no recorded
        length, so their bookings cannot be checked against berth length. Hatched bars mark those.
      </p>
    </main>
  );
}

const selectStyle: React.CSSProperties = {
  font: 'inherit', fontSize: 12, padding: '3px 6px',
  border: '1px solid var(--axis)', borderRadius: 6,
  background: 'var(--surface)', color: 'var(--ink)',
};

const buttonStyle: React.CSSProperties = {
  font: 'inherit', fontSize: 12, padding: '3px 10px',
  border: '1px solid var(--axis)', borderRadius: 6,
  background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
};
