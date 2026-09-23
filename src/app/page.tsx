import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
import { LoadSampleButton, RestorePreviousButton } from '../components/SampleData';
import MonthJump from '../components/MonthJump';
import {
  getBerths, getBookingsInRange, getSummary, getBookingById, getNearestBookedMonth,
  getPreviousSchedule,
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
  // The schedule's own first and last booking widen the window, so anything stored is
  // always reachable. Queried first because every bound below depends on them. Only the
  // floor used to stretch, which left a far-future row visible to the empty-month
  // pointer and unreachable by the navigation it pointed through.
  const summary = await getSummary();
  const earliest = summary.firstYear;
  const latest = summary.lastYear;
  const { year, month } = clampMonth(
    sp.y ? Number(sp.y) : today.year,
    sp.m ? Number(sp.m) : today.month,
    undefined,
    earliest,
    latest,
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
  const prev = step(year, month, -1, undefined, earliest, latest);
  const next = step(year, month, 1, undefined, earliest, latest);
  const navFirst = firstYear(undefined, earliest);
  const navLast = lastYear(undefined, latest);
  const years = Array.from({ length: navLast - navFirst + 1 }, (_, i) => navFirst + i);
  const onToday = isCurrentMonth(year, month);
  const scheduleIsEmpty = summary.bookings === 0;
  // A month with nothing in it is a fair answer, but on its own it is indistinguishable
  // from a broken page. When the schedule has bookings somewhere else, say where.
  const elsewhere =
    bookings.length > 0 || scheduleIsEmpty ? null : await getNearestBookedMonth(bounds.start);
  // Offered on the empty board as well as on Review: whoever just cleared it is looking
  // at this screen, not at the tab they pressed the button on.
  const undo = scheduleIsEmpty ? await getPreviousSchedule() : null;
  /*
    A new booking defaults to the 1st of the month on screen — unless that has passed,
    in which case it defaults to today.

    Without the second half, the page's one filled button opened a form that could not
    be saved. Every booking in the sample is from 1997–2019, so the natural path through
    this app is *browse to a month with bars, then try booking one* — and that opened
    the sheet dated 2010-07-01, with Save disabled and a green "Berth is clear for these
    dates" sitting above a caption refusing it. The form explained itself, which is not
    the same as working.
  */
  const newBookingDate = bounds.start > todayISO() ? bounds.start : todayISO();

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
                  {undo && (
                    <>
                      {' '}Cleared it by mistake?{' '}
                      <RestorePreviousButton bookings={undo.bookings} vessels={undo.vessels} kind={undo.kind} />
                    </>
                  )}
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
