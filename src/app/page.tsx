import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton } from '../components/SampleData';
import MonthJump from '../components/MonthJump';
import {
  getBerths, getBookingsInRange, getSummary, getVesselOptions, getBookingById,
  getNearestBookedMonth,
} from '../db/queries';
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
  const scheduleIsEmpty = summary.bookings === 0;
  // A month with nothing in it is a fair answer, but on its own it is indistinguishable
  // from a broken page. When the schedule has bookings somewhere else, say where.
  const elsewhere =
    bookings.length > 0 || scheduleIsEmpty ? null : await getNearestBookedMonth(bounds.start);
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

      <Board
        berths={berths}
        bookings={bookings}
        year={year}
        month={month}
        selectedId={sp.sel}
        emptyNote={
          // The only screen that explains nothing, so this is where the board says
          // what it is. No title line: the masthead two inches above carries it.
          <div className="boardnote">
            <p>
              <b>
                Nothing booked
                {scheduleIsEmpty ? ' yet' : ` in ${MONTH_NAMES[month - 1]} ${year}`}.
              </b>{' '}
              All {berths.length} berths are free
              {scheduleIsEmpty ? '' : ' for the whole month'}.
            </p>

            <p className="bn-how">
              Berths run down the left, days across the top, one bar per booking.
            </p>
            <ul className="bn-list">
              <li>A bar taller than its lane is a vessel too long for that berth.</li>
              <li>Overlapping bookings cannot be saved at all.</li>
              <li>Click any bar to move or cancel it.</li>
            </ul>

            <p className="bn-more">
              {scheduleIsEmpty ? (
                <>
                  Start with <b>+ New booking</b>, or{' '}
                  <LoadSampleButton label="load the sample schedule" /> &mdash; 23 years
                  of legacy bookings to try the conflict and size checks against,
                  removable at any time from Review.
                </>
              ) : elsewhere ? (
                <>
                  The nearest month with bookings is{' '}
                  <a href={monthHref(elsewhere.year, elsewhere.month)}>
                    {MONTH_NAMES[elsewhere.month - 1]} {elsewhere.year}
                  </a>.
                </>
              ) : null}
            </p>
          </div>
        }
      />

      {selected && (
        <BookingDetail booking={selected} berths={berths} closeHref={monthHref(year, month)} />
      )}

    </main>
  );
}


