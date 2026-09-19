import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton } from '../components/SampleData';
import MonthJump from '../components/MonthJump';
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

      <div className="toolbar">
        <a className="navbtn" href={monthHref(prev.year, prev.month)} aria-label="Previous month">&lsaquo;</a>
        <span className="month">{MONTH_NAMES[month - 1]} {year}</span>
        <a className="navbtn" href={monthHref(next.year, next.month)} aria-label="Next month">&rsaquo;</a>
        {!onToday && (
          <a className="navbtn today" href={monthHref(today.year, today.month)}>Today</a>
        )}

        <MonthJump year={year} month={month} years={years} />

        <span className="spacer" />
        <span className="facts">
          <b>{berths.length}</b> berths
          <i />
          <b>{bookings.length}</b> in {MONTH_NAMES[month - 1]}
          <i />
          <b>{summary.vessels.toLocaleString()}</b> vessels
          {summary.openReviewItems > 0 && (
            <>
              <i />
              <a href="/review" className="flagged">{summary.openReviewItems} to review</a>
            </>
          )}
        </span>
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

    </main>
  );
}


