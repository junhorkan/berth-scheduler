import Board from '../components/Board';
import Nav from '../components/Nav';
import BookingPanel from '../components/BookingPanel';
import BookingDetail from '../components/BookingDetail';
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
 * The twelve-second workbook restore that needed this is no longer reachable from any
 * page. Kept for the margin: a Server Action inherits its route's limit, and one killed
 * at the ten-second default dies mid-transaction and returns nothing to show the user.
 * Booking and editing are single transactions and nowhere near it, cold pool included.
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
  // Checked, not merely present: an id that is not a uuid used to reach SQL and 500
  // the board. An unknown-but-well-formed id returns null, and says so below.
  const selectedId = isBookingId(sp.sel) ? sp.sel : undefined;
  /*
    The selected booking is fetched HERE, beside the summary, because the month depends
    on it. It used to be fetched after `clampMonth` had already decided the month, so a
    link carrying only `?sel=` opened the panel over whatever month the board defaulted
    to: a sheet describing a booking from July 2019 on an empty September 2026 grid.
    Every link the app generates carries a matching `y` and `m`, so this was only ever
    reachable by hand — but a shared or truncated URL is exactly how it would be.

    It costs no extra round trip: it joins a Promise.all with a query already awaited.
  */
  const [summary, selected] = await Promise.all([
    getSummary(),
    selectedId ? getBookingById(selectedId) : Promise.resolve(null),
  ]);
  const earliest = summary.firstYear;
  const latest = summary.lastYear;
  /*
    An explicit `y`/`m` still wins: someone may be comparing a booking against another
    month deliberately, and moving the board under them would be the wrong answer. Only
    a bare `?sel=` takes its month from the booking.
  */
  const anchor = selected && !sp.y && !sp.m
    ? { year: Number(selected.startDate.slice(0, 4)), month: Number(selected.startDate.slice(5, 7)) }
    : { year: sp.y ? Number(sp.y) : today.year, month: sp.m ? Number(sp.m) : today.month };
  const { year, month } = clampMonth(anchor.year, anchor.month, undefined, earliest, latest);

  const bounds = monthBounds(year, month);
  // The vessel register is deliberately NOT fetched here. The booking panel asks for it
  // when it opens; sending it with every board render cost 36KB a page for a list most
  // visits never use. See vesselOptionsAction.
  const [berths, bookings] = await Promise.all([
    getBerths(),
    getBookingsInRange(bounds.start, bounds.end),
  ]);

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
   * gone — it said four things the screen already said (ENGINEERING-LOG 24).
   */
  /*
    At the calendar's ends `step` returns the month you are already on, because
    `clampMonth` clamps rather than signalling a refusal. These were links to their own
    URL: full opacity, focusable, no `aria-disabled`, and pressing one did nothing with
    no explanation — while the Vessels pager, two pages away and wearing the same
    `.navbtn` class, disables properly with a real button.

    So this one does too. A DISABLED button is inert static markup and renders fine from
    a server component; only an enabled one would need a handler, and one is never drawn.
  */
  const atFirst = prev.year === year && prev.month === month;
  const atLast = next.year === year && next.month === month;

  const head = (
    <div className="boardhead">
      {atFirst ? (
        <button className="navbtn" disabled aria-label="Previous month">&lsaquo;</button>
      ) : (
        <a className="navbtn" href={monthHref(prev.year, prev.month)} aria-label="Previous month">&lsaquo;</a>
      )}
      <span className="month">{MONTH_NAMES[month - 1]} {year}</span>
      {atLast ? (
        <button className="navbtn" disabled aria-label="Next month">&rsaquo;</button>
      ) : (
        <a className="navbtn" href={monthHref(next.year, next.month)} aria-label="Next month">&rsaquo;</a>
      )}
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
            viewYear={year}
            viewMonth={month}
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
                /*
                  No button here offers to load a schedule any more. On a public page
                  with no accounts, nothing should replace everyone's data in one press —
                  loading the workbook is `npm run import`, behind the credentials. What
                  is left is the one thing a visitor can honestly do from an empty board.
                */
                <>Start with <b>+ New booking</b>.</>
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
                <li>Click any bar to edit or cancel it, while it is still to come.</li>
                <li>A booking that has ended is the record, and is read-only.</li>
              </ul>
            </details>
          </div>
        }
      />

      {/*
        A link to a booking that is no longer there — shared before someone cancelled it,
        or mistyped — used to open the board with no panel and no word about why. That is
        the one thing invariant 8 forbids: empty is supported, and never silent.
      */}
      {selectedId && !selected && (
        <p className="note">No booking matches that link. It may have been cancelled.</p>
      )}

      {selected && (
        <BookingDetail booking={selected} berths={berths} closeHref={monthHref(year, month)} />
      )}
    </main>
  );
}
