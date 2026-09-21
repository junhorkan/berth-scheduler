/**
 * The board: berths down, days across — the mental model the coordinator already has.
 *
 * What makes it more than a redrawn spreadsheet is that a bar's HEIGHT encodes fit.
 * height = vessel length / berth length, so a 145' vessel in a 90' berth is drawn 1.61
 * lanes tall and visibly breaks out of its row. The misfit is geometry, not a message
 * you have to go looking for.
 *
 * This is the standard space-time representation of the berth allocation problem
 * (time on one axis, quay space on the other, rectangle height = vessel length),
 * adapted to fixed discrete berths.
 */
import type { ReactNode } from 'react';
import type { BerthRow, BookingRow } from '../db/queries';
import { barGeometry, clipToMonth, daysInMonth, packLanes } from '../lib/layout';
import { todayISO } from '../lib/nav';
import { barHeightRatio, checkFit } from '../domain/fit';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2010-07-09` -> `9 Jul`. Read from the string, never through Date. */
function formatDay(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]}`;
}

/**
 * Inner track height in px representing exactly the berth's full length.
 *
 * Seven 30px lanes left most of a desktop viewport empty and made every bar a thin
 * sliver. At this height the board fills the screen it is given, and a vessel that
 * overhangs its lane overhangs it by a visible amount rather than a few pixels.
 */
const TRACK = 52;
/** Beyond this the bar would cover two rows; the numeric label still tells the truth. */
const MAX_RATIO = 2.4;
/**
 * A floor so that a small vessel in a very large berth stays visible. A 40' vessel in
 * the 410' berth is only 0.098 of the lane — truthful, but a 3px hairline reads as an
 * empty berth, and "is anything booked here" must never be ambiguous. Proportionality
 * still governs everything above the floor, including every overflow case.
 */
const MIN_BAR_PX = 14;
/** Below this many days a bar is too narrow to hold readable text. */
const MIN_DAYS_FOR_LABEL = 3;

type Placed = {
  booking: BookingRow;
  startDay: number;
  endDay: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

export default function Board({
  berths,
  bookings,
  year,
  month,
  selectedId,
  emptyNote,
  head,
}: {
  berths: BerthRow[];
  bookings: BookingRow[];
  year: number;
  month: number;
  selectedId?: string;
  /** Shown above the grid when this month holds nothing. The grid still draws. */
  emptyNote?: ReactNode;
  /** The month navigation, drawn inside the card as its header. */
  head?: ReactNode;
}) {
  const days = daysInMonth(year, month);
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const dow = dayNums.map((d) => new Date(Date.UTC(year, month - 1, d)).getUTCDay());

  // The board opens on the current month, so say which day that is. Without it an
  // empty future month gives no anchor for "where am I now".
  const iso = todayISO();
  const todayDay =
    Number(iso.slice(0, 4)) === year && Number(iso.slice(5, 7)) === month
      ? Number(iso.slice(8, 10))
      : null;

  const byBerth = new Map<string, Placed[]>();
  for (const b of bookings) {
    const c = clipToMonth({ start: b.startDate, end: b.endDate }, year, month);
    if (!c) continue;
    const list = byBerth.get(b.berthId) ?? [];
    list.push({ booking: b, ...c });
    byBerth.set(b.berthId, list);
  }

  return (
    <div className="board">
      {head}
      {bookings.length === 0 && emptyNote}
      <div className="gridrow" style={{ ['--days' as string]: days }}>
        {/* day header */}
        <div />
        <div className="dayhead">
          {dayNums.map((d, i) => (
            <span
              key={d}
              className={`d${dow[i] === 0 || dow[i] === 6 ? ' wknd' : ''}${d === todayDay ? ' today' : ''}`}
              aria-current={d === todayDay ? 'date' : undefined}
            >
              {d}
              <span className="dow">{WEEKDAY[dow[i]]}</span>
            </span>
          ))}
        </div>

        {berths.map((berth) => {
          const placed = byBerth.get(berth.id) ?? [];
          const packed = packLanes(placed, (p) => ({ startDay: p.startDay, endDay: p.endDay }));
          const laneCount = Math.max(1, ...packed.map((p) => p.lane + 1));
          const rowHeight = laneCount * (TRACK + 8) + 6;

          return (
            <BerthLane
              key={berth.id}
              berth={berth}
              packed={packed}
              laneCount={laneCount}
              rowHeight={rowHeight}
              days={days}
              dow={dow}
              todayDay={todayDay}
              year={year}
              month={month}
              selectedId={selectedId}
            />
          );
        })}
      </div>

      {bookings.length > 0 && <Legend />}
    </div>
  );
}

function BerthLane({
  berth,
  packed,
  laneCount,
  rowHeight,
  days,
  dow,
  todayDay,
  year,
  month,
  selectedId,
}: {
  berth: BerthRow;
  packed: { item: Placed; lane: number }[];
  laneCount: number;
  rowHeight: number;
  days: number;
  dow: number[];
  todayDay: number | null;
  year: number;
  month: number;
  selectedId?: string;
}) {
  return (
    <>
      <div className="rail" style={{ height: rowHeight }}>
        <b>{berth.name.replace(' (institution boats)', '')}</b>
        {berth.lengthFt != null ? (
          <i>{berth.lengthFt}&prime;</i>
        ) : (
          <span className="pooled">pooled &middot; no stated length</span>
        )}
      </div>

      <div className="lane" style={{ height: rowHeight }}>
        {/* weekend shading, so the calendar rhythm of the old grid survives */}
        {dow.map((d, i) =>
          d === 0 || d === 6 ? (
            <span
              key={i}
              className="wkndcol"
              style={{ left: `${(i / days) * 100}%`, width: `${(1 / days) * 100}%` }}
            />
          ) : null,
        )}

        {todayDay !== null && (
          <span
            className="todaycol"
            style={{ left: `${((todayDay - 1) / days) * 100}%`, width: `${(1 / days) * 100}%` }}
          />
        )}

        {packed.map(({ item, lane }) => (
          <Bar
            key={item.booking.id}
            placed={item}
            berth={berth}
            lane={lane}
            laneCount={laneCount}
            days={days}
            year={year}
            month={month}
            selected={selectedId === item.booking.id}
          />
        ))}
      </div>
    </>
  );
}

function Bar({
  placed,
  berth,
  lane,
  laneCount,
  days,
  year,
  month,
  selected,
}: {
  placed: Placed;
  berth: BerthRow;
  lane: number;
  laneCount: number;
  days: number;
  year: number;
  month: number;
  selected: boolean;
}) {
  const { booking } = placed;
  const { left, width } = barGeometry(placed.startDay, placed.endDay, days);

  const fit =
    booking.kind === 'vessel' ? checkFit(booking.vesselLengthFt, berth.lengthFt) : null;
  const ratio = Math.min(
    MAX_RATIO,
    booking.kind === 'vessel' ? barHeightRatio(booking.vesselLengthFt, berth.lengthFt) : 0.68,
  );
  const heightPx = Math.max(MIN_BAR_PX, ratio * TRACK);
  const spanDays = placed.endDay - placed.startDay + 1;
  // Narrow bars carry no text: a truncated 'R...' is noise, and the tooltip has it all.
  const showLabel = spanDays >= MIN_DAYS_FOR_LABEL;
  // A violation must ALWAYS say why, at any width. Six of the nine violations in the
  // source are single-day bookings — including the worst, a 170' vessel in a 90' berth —
  // so gating this on width hid most of them behind a hover. Narrow bars render the
  // measurement as a badge above the bar, which already overflows its lane anyway.
  const isTooLong = fit?.verdict === 'too_long';
  const showOverflowInline = isTooLong && spanDays >= 3;
  const showOverflowBadge = isTooLong && spanDays < 3;

  // An absolutely positioned tooltip still counts toward scrollable overflow, so one
  // anchored left on a right-hand bar widens the card and makes it lurch sideways on
  // hover. Bars past the midpoint hang their tooltip the other way instead. The
  // violation badge hangs off the same class, for the same reason and one worse: it
  // is always visible, so a late-month violation read `120ft in 75ft be` — the one
  // measurement that must survive at any width, cut off by the card.
  const tipSide = left > 55 ? 'tipright' : 'tipleft';

  const classes = [
    tipSide,'bar'];
  if (booking.kind === 'closure') classes.push('closure');
  else if (booking.kind === 'event') classes.push('event');
  else if (fit?.verdict === 'too_long') classes.push('toolong');
  else if (fit?.verdict === 'unverified') classes.push('unknown');
  else classes.push('vessel');
  if (booking.status === 'conflict_unresolved') classes.push('unresolved');
  if (selected) classes.push('selected');

  // Sub-lanes stack upward from the bottom of the row.
  const bottom = 3 + (laneCount - 1 - lane) * (TRACK + 8);

  // Plain language, one line, shown instantly on hover. The native `title` attribute
  // held this already but took about a second to appear and most people never waited,
  // so the board looked unexplained while carrying its own explanation.
  const tip = [
    booking.label,
    `${formatDay(booking.startDate)} \u2013 ${formatDay(booking.endDate)}`,
    `${berth.name}${berth.lengthFt != null ? ` \u00b7 ${berth.lengthFt}ft berth` : ''}`,
    fit?.verdict === 'too_long'
      ? `does not fit: vessel is ${booking.vesselLengthFt}ft`
      : fit?.verdict === 'unverified'
        ? 'length not recorded, so the fit cannot be checked'
        : booking.vesselLengthFt != null
          ? `vessel ${booking.vesselLengthFt}ft \u2014 fits`
          : null,
    booking.status === 'conflict_unresolved' ? 'UNRESOLVED CONFLICT' : null,
  ]
    .filter(Boolean)
    .join('  \u00b7  ');

  return (
    <a
      href={`/?y=${year}&m=${month}&sel=${booking.id}`}
      className={classes.join(' ')}
      style={{ left: `${left}%`, width: `${width}%`, height: heightPx, bottom }}
      data-tip={tip}
      aria-label={tip}
    >
      {placed.clippedStart && <span className="clip" aria-label="continues from previous month">&larr;</span>}
      {showLabel && !showOverflowInline && <span className="lbl">{booking.label}</span>}
      {showOverflowInline && (
        <span className="ft">
          {booking.vesselLengthFt}ft in {berth.lengthFt}ft berth
        </span>
      )}
      {showOverflowBadge && (
        <span className="ftbadge">
          {booking.vesselLengthFt}ft in {berth.lengthFt}ft berth
        </span>
      )}
      {placed.clippedEnd && <span className="clip" aria-label="continues into next month">&rarr;</span>}
    </a>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div><span className="sw vessel" />Vessel fits its berth</div>
      <div><span className="sw unknown" />Length unknown &mdash; fit not checked</div>
      <div><span className="sw toolong" />Too long: bar breaks out of its lane</div>
      <div><span className="sw event" />Event, not a vessel</div>
      <div><span className="sw closure" />Berth closed</div>
      {/*
        The height rule, said once. The legend used to explain only colour and hatching,
        so the most important thing on the board — that a bar's height IS the fit check —
        was the one thing it never mentioned, and a first-time reader had to infer it.
      */}
      <div className="legend-rule">Bar height is the vessel against its berth: 120ft in a 240ft berth fills half the lane.</div>
      <div className="legend-hint">Hover any bar for detail, or click it to edit.</div>
    </div>
  );
}
