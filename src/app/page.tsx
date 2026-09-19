import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton } from '../components/SampleData';
import { getBerths, getBookingsInRange, getSummary, getVesselOptions, getBookingById } from '../db/queries';
import { monthBounds } from '../lib/layout';
import {
  clampMonth, monthHref, MONTH_NAMES, step, currentMonth, lastYear, lastBookableISO,
  todayISO, isCurrentMonth, FIRST_YEAR, SAMPLE_LAST_YEAR, BUSIEST_MONTH,
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
  const { year, month } = clampMonth(
    sp.y ? Number(sp.y) : today.year,
    sp.m ? Number(sp.m) : today.month,
  );

  const bounds = monthBounds(year, month);
  const [berths, bookings, summary, vessels] = await Promise.all([
    getBerths(),
    getBookingsInRange(bounds.start, bounds.end),
    getSummary(),
    getVesselOptions(),
  ]);

  const selected = sp.sel ? await getBookingById(sp.sel) : null;
  const prev = step(year, month, -1);
  const next = step(year, month, 1);
  const years = Array.from({ length: lastYear() - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const onToday = isCurrentMonth(year, month);
  const scheduleIsEmpty = summary.bookings === 0;
  // A new booking defaults to today when you are on this month, and to the 1st otherwise.
  const newBookingDate = onToday ? todayISO() : bounds.start;

  return (
    <main className="shell">
      <Nav current="board" />

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
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {bookings.length} booking{bookings.length === 1 ? '' : 's'} this month
        </span>
        <BookingPanel
          berths={berths}
          vessels={vessels}
          defaultDate={newBookingDate}
          maxDate={lastBookableISO()}
        />
      </div>

      {bookings.length === 0 && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            <b>Nothing booked in {MONTH_NAMES[month - 1]} {year}.</b> Every berth below is free
            &mdash; use <b>+ New booking</b> to reserve one.
          </p>
          {scheduleIsEmpty ? (
            // The sample is a demonstration, not this facility's history, so it is not
            // loaded by default. Offer it here, where someone evaluating the system
            // is certain to be looking.
            <p className="note" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <LoadSampleButton label="↻ Load the sample schedule" />
              <span>
                23 years of real bookings ({FIRST_YEAR}&ndash;{SAMPLE_LAST_YEAR}) to try the
                conflict and size checks against. Removable at any time from Review.
              </span>
            </p>
          ) : (
            <p className="note" style={{ marginTop: 6 }}>
              The loaded sample schedule runs August {FIRST_YEAR} to December {SAMPLE_LAST_YEAR}.{' '}
              <a href={monthHref(BUSIEST_MONTH.year, BUSIEST_MONTH.month)}>
                See {MONTH_NAMES[BUSIEST_MONTH.month - 1]} {BUSIEST_MONTH.year}
              </a>, its busiest month.
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
