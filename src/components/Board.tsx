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
import type { BerthRow, BookingRow } from '../db/queries';
import { barGeometry, clipToMonth, daysInMonth, packLanes } from '../lib/layout';
import { barHeightRatio, checkFit } from '../domain/fit';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Inner track height in px that represents exactly the berth's full length. */
const TRACK = 30;
/** Beyond this the bar would cover two rows; the numeric label still tells the truth. */
const MAX_RATIO = 2.4;
/**
 * A floor so that a small vessel in a very large berth stays visible. A 40' vessel in
 * the 410' berth is only 0.098 of the lane — truthful, but a 3px hairline reads as an
 * empty berth, and "is anything booked here" must never be ambiguous. Proportionality
 * still governs everything above the floor, including every overflow case.
 */
const MIN_BAR_PX = 9;
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
}: {
  berths: BerthRow[];
  bookings: BookingRow[];
  year: number;
  month: number;
  selectedId?: string;
}) {
  const days = daysInMonth(year, month);
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const dow = dayNums.map((d) => new Date(Date.UTC(year, month - 1, d)).getUTCDay());

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
      <div className="gridrow" style={{ ['--days' as string]: days }}>
        {/* day header */}
        <div />
        <div className="dayhead">
          {dayNums.map((d, i) => (
            <span key={d} className={`d${dow[i] === 0 || dow[i] === 6 ? ' wknd' : ''}`}>
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
              year={year}
              month={month}
              selectedId={selectedId}
            />
          );
        })}
      </div>

      <Legend />
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

  const classes = ['bar'];
  if (booking.kind === 'closure') classes.push('closure');
  else if (booking.kind === 'event') classes.push('event');
  else if (fit?.verdict === 'too_long') classes.push('toolong');
  else if (fit?.verdict === 'unverified') classes.push('unknown');
  else classes.push('vessel');
  if (booking.status === 'conflict_unresolved') classes.push('unresolved');
  if (selected) classes.push('selected');

  // Sub-lanes stack upward from the bottom of the row.
  const bottom = 3 + (laneCount - 1 - lane) * (TRACK + 8);

  const title = [
    booking.label,
    `${booking.startDate} to ${booking.endDate}`,
    `${berth.name}${berth.lengthFt != null ? ` (${berth.lengthFt}ft)` : ''}`,
    booking.vesselLengthFt != null ? `vessel ${booking.vesselLengthFt}ft` : 'vessel length not recorded',
    fit ? fit.reason : booking.kind,
    booking.status === 'conflict_unresolved' ? 'UNRESOLVED CONFLICT from the legacy schedule' : '',
    booking.notes ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <a
      href={`/?y=${year}&m=${month}&sel=${booking.id}`}
      className={classes.join(' ')}
      style={{ left: `${left}%`, width: `${width}%`, height: heightPx, bottom }}
      title={title}
      aria-label={title.split('\n').slice(0, 3).join(', ')}
    >
      {placed.clippedStart && <span className="clip" aria-label="continues from previous month">&larr;</span>}
      {showLabel && !showOverflowInline && <span className="lbl">{booking.label}</span>}
      {showOverflowInline && (
        <span className="ft">
          {booking.vesselLengthFt}&prime; &gt; {berth.lengthFt}&prime;
        </span>
      )}
      {showOverflowBadge && (
        <span className="ftbadge">
          {booking.vesselLengthFt}&prime; &gt; {berth.lengthFt}&prime;
        </span>
      )}
      {placed.clippedEnd && <span className="clip" aria-label="continues into next month">&rarr;</span>}
    </a>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div><span className="sw vessel" />vessel, fits</div>
      <div><span className="sw unknown" />length not recorded</div>
      <div><span className="sw toolong" />does not fit the berth</div>
      <div><span className="sw event" />non-vessel event</div>
      <div><span className="sw closure" />berth closed</div>
      <div style={{ color: 'var(--ink-muted)' }}>
        bar height = vessel length &divide; berth length
      </div>
    </div>
  );
}
