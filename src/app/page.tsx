import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton } from '../components/SampleData';
import MonthJump from '../components/MonthJump';
import {
  getBerths, getBookingsInRange, getSummary, getBookingById, getNearestBookedMonth,
} from '../db/queries';
import { monthBounds } from '../lib/layout';
import {
  clampMonth, monthHref, MONTH_NAMES, step, currentMonth, firstYear, lastYear,
  firstBookableISO, lastBookableISO, todayISO, isCurrentMonth, isBookingId,
} from '../lib/nav';

// A cached schedule is a wrong schedule.
export const dynamic = 'force-dynamic';
/**
 * Server Actions inherit this route's function limit, and the sample controls live here.
 * Restoring the workbook deletes and re-inserts 2,031 bookings, 418 vessels and their
 * review items in one transaction, which measured at roughly 12 seconds — past Vercel's
 * 10-second default, where the function is killed mid-transaction and the button simply
 * appears to do nothing.
 */
export const maxDuration = 60;

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; sel?: string }>;
}) {
  const sp = await searchParams;
  const today = currentMonth();
  // The schedule's own earliest booking widens the window, so anything stored is
  // always reachable. Queried first because every bound below depends on it.
  const summary = await getSummary();
  const earliest = summary.firstYear;
  const { year, month } = clampMonth(
    sp.y ? Number(sp.y) : today.year,
    sp.m ? Number(sp.m) : today.month,
    undefined,
    earliest,
  );

  const bounds = monthBounds(year, month);
  // The vessel register is deliberately NOT fetched here. The booking panel asks for it
  // when it opens; sending it with every board render cost 36KB a page for a list most
  // visits never use. See vesselOptionsAction.
  const [berths, bookings] = await Promise.all([
    getBerths(),
    getBookingsInRange(bounds.start, bounds.end),
  ]);

  // Checked, not merely present: an id that is not a uuid used to reach SQL and 500
  // the board. An unknown-but-well-formed id already returns null and draws no sheet.
  const selectedId = isBookingId(sp.sel) ? sp.sel : undefined;
  const selected = selectedId ? await getBookingById(selectedId) : null;
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

  /**
   * The month navigation, drawn inside the board card as its header rather than in a
   * bar of its own: it navigates the grid and nothing else, and one fewer box on
   * screen is one fewer thing to parse. The count strip that used to sit beside it is
   * gone — it said four things the screen already said (DECISIONS 24).
   */
  const head = (
    <div className="boardhead">
      <a className="navbtn" href={monthHref(prev.year, prev.month)} aria-label="Previous month">&lsaquo;</a>
      <span className="month">{MONTH_NAMES[month - 1]} {year}</span>
      <a className="navbtn" href={monthHref(next.year, next.month)} aria-label="Next month">&rsaquo;</a>
      {!onToday && (
        <a className="navbtn today" href={monthHref(today.year, today.month)}>Today</a>
      )}
      <span className="spacer" />
      <MonthJump year={year} month={month} years={years} />
    </div>
  );

  return (
    <main className="shell">
      <Nav
        current="board"
        tagline="Book a berth, check any date, and never double-book one."
        actions={
          <BookingPanel
            berths={berths}
            defaultDate={newBookingDate}
            minDate={firstBookableISO()}
            maxDate={lastBookableISO()}
          />
        }
      />

      <Board
        berths={berths}
        bookings={bookings}
        year={year}
        month={month}
        selectedId={selectedId}
        head={head}
        emptyNote={
          // The only screen that renders no explanation of its own, so this is where the
          // board says how to read itself. The two facts stay visible; the three rules
          // sit behind a label that says what they are, because "Info" is not a reason
          // to click and whoever needs them would never press it.
          <div className="boardnote">
            <p>
              <b>
                {scheduleIsEmpty
                  ? 'The schedule is empty.'
                  : `${MONTH_NAMES[month - 1]} ${year} is empty.`}
              </b>{' '}
              {scheduleIsEmpty ? (
                <>
                  Start with <b>+ New booking</b>, or{' '}
                  <LoadSampleButton label="load the sample schedule" /> &mdash; 23 years
                  of legacy bookings to try the checks against.
                </>
              ) : elsewhere ? (
                <>
                  Nearest bookings:{' '}
                  <a href={monthHref(elsewhere.year, elsewhere.month)}>
                    {MONTH_NAMES[elsewhere.month - 1]} {elsewhere.year}
                  </a>.
                </>
              ) : null}
            </p>

            <details>
              <summary>How to read this board</summary>
              <ul className="bn-list">
                <li>A bar taller than its lane is a vessel too long for that berth.</li>
                <li>Overlapping bookings cannot be saved at all.</li>
                <li>Click any bar to move or cancel it.</li>
              </ul>
            </details>
          </div>
        }
      />

      {selected && (
        <BookingDetail booking={selected} berths={berths} closeHref={monthHref(year, month)} />
      )}
    </main>
  );
}
