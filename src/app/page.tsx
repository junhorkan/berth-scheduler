import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton } from '../components/SampleData';
import { getBerths, getBookingsInRange, getSummary, getVesselOptions, getBookingById } from '../db/queries';
import { monthBounds } from '../lib/layout';
import {
  clampMonth, monthHref, MONTH_NAMES, step, currentMonth, firstYear, lastYear,
  firstBookableISO, lastBookableISO, todayISO, isCurrentMonth,
} from '../lib/nav';

// A cached schedule is a wrong schedule.
export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; sel?: string }>;
}) {
  const sp = await searchParams;
  const today = currentMonth();
  // The schedule's own earliest booking widens the window, so anything stored is
  // always reachable. Queried first because every bound below depends on it.
  const { firstYear: earliest } = await getSummary();
  const { year, month } = clampMonth(
    sp.y ? Number(sp.y) : today.year,
    sp.m ? Number(sp.m) : today.month,
    undefined,
    earliest,
  );

  const bounds = monthBounds(year, month);
  const [berths, bookings, summary, vessels] = await Promise.all([
    getBerths(),
    getBookingsInRange(bounds.start, bounds.end),
    getSummary(),
    getVesselOptions(),
  ]);

  const selected = sp.sel ? await getBookingById(sp.sel) : null;
  const prev = step(year, month, -1, undefined, earliest);
  const next = step(year, month, 1, undefined, earliest);
  const navFirst = firstYear(undefined, earliest);
  const years = Array.from({ length: lastYear() - navFirst + 1 }, (_, i) => navFirst + i);
  const onToday = isCurrentMonth(year, month);
  // A new booking defaults to today when you are on this month, and to the 1st otherwise.
  const newBookingDate = onToday ? todayISO() : bounds.start;

  return (
    <main className="shell">
      <Nav current="board" />

      <div className="stats">
        <div className="stat">
          <b>{berths.length}</b>
          <span>Berths</span>
        </div>
        <div className="stat">
          <b>{bookings.length}</b>
          <span>Booked in {MONTH_NAMES[month - 1]}</span>
        </div>
        <div className="stat">
          <b>{summary.vessels.toLocaleString()}</b>
          <span>Vessels on register</span>
        </div>
        <div className={`stat${summary.openReviewItems > 0 ? ' flagged' : ''}`}>
          <b>{summary.openReviewItems}</b>
          <span>Needs review</span>
        </div>
      </div>

      <div className="toolbar">
        <a className="navbtn" href={monthHref(prev.year, prev.month)} aria-label="Previous month">&lsaquo;</a>
        <span className="month">{MONTH_NAMES[month - 1]} {year}</span>
        <a className="navbtn" href={monthHref(next.year, next.month)} aria-label="Next month">&rsaquo;</a>
        {!onToday && (
          <a className="navbtn today" href={monthHref(today.year, today.month)}>Today</a>
        )}

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
        <BookingPanel
          berths={berths}
          vessels={vessels}
          defaultDate={newBookingDate}
          minDate={firstBookableISO()}
          maxDate={lastBookableISO()}
        />
      </div>

      {bookings.length === 0 && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            <b>Nothing booked in {MONTH_NAMES[month - 1]} {year}.</b> Every berth below is free
            &mdash; use <b>+ New booking</b> to reserve one.
          </p>
          {summary.bookings === 0 && (
            <p className="note" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <LoadSampleButton label="\u21bb Load the sample schedule" />
              <span>
                23 years of legacy bookings to try the conflict and size checks against.
                Removable at any time from Review.
              </span>
            </p>
          )}
        </div>
      )}

      <Board berths={berths} bookings={bookings} year={year} month={month} selectedId={sp.sel} />

      {selected && (
        <BookingDetail booking={selected} berths={berths} closeHref={monthHref(year, month)} />
      )}

      {summary.vessels > 0 && (
      <p className="note">
        {summary.vessels - summary.vesselsWithLength} of {summary.vessels} vessels have no recorded
        length, so their bookings cannot be checked against berth length. Hatched bars mark those.
      </p>
      )}
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
