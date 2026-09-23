'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  checkBookingAction, createBookingAction, berthOccupancyAction, vesselOptionsAction,
} from '../app/actions';
import type { BerthRow, VesselOption } from '../db/queries';
import type { CheckResult } from '../db/mutations';
import type { BookingKind } from '../domain/types';
import { cleanNotes } from '../domain/edit';
import { describeChoices, suggestBerth } from '../lib/suggest';
import { parseLengthFt } from '../lib/length';
import { formatSpanFull } from '../lib/search';
import type { Occupancy } from '../lib/suggest';

/**
 * New booking, opening OVER the board rather than on its own page, so the grid stays
 * visible behind it.
 *
 * The verdict strip is the design argument made visible, and the two states are
 * deliberately not the same shape:
 *
 *   RED    a conflict. The database's exclusion constraint will refuse this write, so
 *          Save is disabled. There is no override.
 *   AMBER  a fit problem. Advisory only, and never blocks — because 95% of vessels
 *          have no recorded length, so blocking on it would make the tool unusable.
 *   AMBER  the same hull booked at another berth over these days. Also advisory, for a
 *          different reason: the imported schedule already contains twelve of them
 *          (domain/conflicts.findVesselClashes).
 *
 * The caption under Save always names which condition disabled it.
 */
export default function BookingPanel({
  berths,
  defaultDate,
  viewYear,
  viewMonth,
  minDate,
  maxDate,
}: {
  berths: BerthRow[];
  defaultDate: string;
  /** The month the board is showing, so a save knows whether it lands out of sight. */
  viewYear: number;
  viewMonth: number;
  /** The bookable window, from lib/nav. Hard-coding it here let the form accept dates
   *  the board could not navigate to, which is how a saved booking became invisible. */
  minDate: string;
  maxDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** The check did not come back. Distinct from "came back and said no". */
  const [checkFailed, setCheckFailed] = useState(false);
  /**
   * The register, fetched the first time this panel opens.
   *
   * `null` means "not here yet", which is different from "no vessels": until it
   * arrives the field still accepts anything, because an unmatched name is a new
   * vessel and the save path resolves a known one by name on the server. What waits
   * is the autocomplete list and the recorded length, not the ability to book.
   */
  const [vessels, setVessels] = useState<VesselOption[] | null>(null);
  const [kind, setKind] = useState<BookingKind>('vessel');
  const [berthId, setBerthId] = useState(berths[0]?.id ?? '');
  const [vesselName, setVesselName] = useState('');
  /**
   * A length for a vessel that has none — typed at the one moment somebody knows it.
   *
   * Optional, always. Invariant 2 says never invent a length and never gate a booking
   * on one, so blank stays blank and saves a booking with no measurement, exactly as
   * before. What it must not do is make the form refuse work.
   */
  const [lengthInput, setLengthInput] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(defaultDate);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, Occupancy[]> | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || vessels !== null) return;
    let live = true;
    vesselOptionsAction()
      .then((rows) => { if (live) setVessels(rows); })
      // A failed fetch must not break booking: an empty register behaves exactly like
      // a name nobody knows, which is a supported path.
      .catch(() => { if (live) setVessels([]); });
    return () => { live = false; };
  }, [open, vessels]);

  const vessel = vessels?.find((v) => v.name.toLowerCase() === vesselName.trim().toLowerCase());
  const vesselId = kind === 'vessel' ? vessel?.id ?? null : null;
  const effectiveLabel = kind === 'vessel' ? vessel?.name ?? vesselName.trim() : label.trim();

  // Offered only where there is a gap to fill: a hull already measured is not re-asked,
  // and an event or a closure has no vessel to measure.
  const asksForLength =
    kind === 'vessel' && vesselName.trim() !== '' && (vessel ? vessel.lengthFt == null : true);
  const parsedLength = parseLengthFt(asksForLength ? lengthInput : '');
  const typedLength = parsedLength.ok ? parsedLength.value : null;

  // Live verdict. Debounced so typing a date does not fire a request per keystroke.
  //
  // The generation counter matters: clearTimeout cancels a pending timer but cannot
  // cancel a request already in flight. Without it a slow earlier check can resolve
  // after a faster later one and overwrite the verdict — showing "berth is clear" for
  // dates that conflict, or the reverse. The database would still refuse a bad write,
  // but the user would have been told the opposite of the truth right up to the click.
  const generation = useRef(0);
  useEffect(() => {
    if (!open || !berthId || !start || !end) return;
    const mine = ++generation.current;
    const t = setTimeout(async () => {
      // Set inside the timer, not the effect body: a synchronous setState in an effect
      // cascades a render, and the "Checking…" line is only read before the first
      // verdict lands anyway, so the 280ms delay costs nothing visible.
      setChecking(true);
      setCheckFailed(false);
      try {
        // Both in one round trip: the verdict for the chosen berth, and what every
        // other berth is doing, so the dropdown can say so without a second wait.
        const [result, occ] = await Promise.all([
          checkBookingAction({ berthId, vesselId, kind, start, end, vesselLengthFt: typedLength }),
          berthOccupancyAction(start, end),
        ]);
        if (mine === generation.current) { setCheck(result); setOccupancy(occ); }
      } catch {
        /*
          Whatever went wrong, the one thing that must not survive it is the previous
          answer. A verdict left on screen from the last set of dates reads as a
          guarantee about the current ones, and `canSave` is computed from it — so a
          failed check would enable Save on dates nothing had looked at.
        */
        if (mine === generation.current) {
          setCheck(null);
          setOccupancy(null);
          setCheckFailed(true);
        }
      } finally {
        if (mine === generation.current) setChecking(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [open, berthId, vesselId, kind, start, end, typedLength]);

  /**
   * A name that matches nothing on the register is a NEW vessel, not an error.
   *
   * This used to block the save and tell the user to "add it on the Vessels tab
   * first" — which was impossible, because that tab only edits lengths of vessels
   * that already exist. Starting from an empty schedule every vessel is new, so the
   * gate made vessel bookings unreachable. Saving registers it instead.
   */
  /**
   * What each berth is doing on these dates, and which one to propose.
   *
   * Both come from `lib/suggest`, which is pure: the server returns raw occupancy and
   * the wording and ranking happen here, where the berth list and the vessel's length
   * already are. Before the first check lands `choices` is empty and the dropdown falls
   * back to plain names, so the form is never unusable while waiting.
   */
  const vesselLengthFt =
    kind === 'vessel' ? typedLength ?? vessel?.lengthFt ?? null : null;
  const choices = occupancy
    ? describeChoices(berths, new Map(Object.entries(occupancy)), vesselLengthFt, kind === 'vessel')
    : [];

  function findBerth() {
    if (!choices.length) return;
    const s = suggestBerth(choices, vesselLengthFt);
    if (s.berthId) setBerthId(s.berthId);
    setSuggestion(s.reason);
  }

  const isNewVessel =
    kind === 'vessel' && vessels !== null && !vessel && vesselName.trim() !== '';
  const missingLabel = effectiveLabel === '';
  // No answer is not a yes: Save waits rather than assuming the berth is free.
  const blocked = checkFailed || (check ? !check.bookable : false);
  /**
   * `min` on a date input only constrains the picker. Saving happens through a click
   * handler rather than native form submission, so a date typed or pasted straight in
   * would otherwise sail past it.
   */
  const startsInPast = start < minDate;
  // `max` guards the picker the same way `min` does, and a pasted date sails past both.
  // The save path refuses this too; without it here, Save looked available for a date
  // the board could never navigate to.
  const endsAfterWindow = end > maxDate;
  /*
    A length typed and not understood stops the save — but only once something has been
    typed. Blank is a complete answer and never blocks (invariant 2).

    The alternative was to ignore what it could not parse, which saves the booking with
    no length and tells nobody the number was dropped. Silently discarding something
    somebody took the trouble to type is worse than asking them to fix it.
  */
  const lengthUnreadable = asksForLength && lengthInput.trim() !== '' && !parsedLength.ok;
  const canSave =
    !blocked && !missingLabel && !startsInPast && !endsAfterWindow
    && !lengthUnreadable && !pending;

  /*
    The caption under Save always names which condition disabled it — a list rather
    than a ladder of ternaries, in the order the reasons should be read. Two additions
    were silently lost inside the nested version before it was written out like this,
    which is exactly the failure a disabled button with no caption produces.
  */
  const reasons: [boolean, string][] = [
    [checkFailed, 'Could not check these dates. Change them, or try again in a moment.'],
    [blocked, check?.blockedBecause ?? 'This berth is already occupied.'],
    [startsInPast, 'A berth cannot be reserved for a day that has already passed.'],
    [endsAfterWindow, `The schedule only takes bookings up to ${maxDate.slice(0, 4)}.`],
    [lengthUnreadable, parsedLength.ok ? '' : parsedLength.error],
    [missingLabel, kind === 'vessel' ? 'Name the vessel.' : 'Give this booking a name.'],
  ];
  const disabledReason = reasons.find(([when]) => when)?.[1] ?? null;

  function save() {
    setSaveError(null);
    startTransition(async () => {
      const res = await createBookingAction({
        berthId, vesselId, kind, label: effectiveLabel, start, end,
        notes: cleanNotes(notes), vesselLengthFt: typedLength,
      });
      if (res.ok) {
        /*
          Usually just close: the board behind the sheet already shows the month the
          booking is in, and the new bar appears there on revalidate. That is the
          confirmation, and it costs no second panel to dismiss.

          But the default date is today whenever the month on screen has passed, so a
          booking made while browsing 2010 lands somewhere the board is not showing, and
          "saved, and nothing appeared" is indistinguishable from failure. Only then is
          it worth moving the board — and it arrives with the booking selected, so which
          bar is the new one is not a guess.
        */
        const y = Number(start.slice(0, 4));
        const m = Number(start.slice(5, 7));
        if (y !== viewYear || m !== viewMonth) {
          // Close first. `router.push` swaps the page under the sheet but does not
          // unmount it, so the filled-in create form stayed mounted beneath the new
          // booking's own panel — two dialogs, two overlays, and a still-enabled Save
          // on the one underneath.
          setOpen(false);
          router.push(`/?y=${y}&m=${m}&sel=${res.id}`);
          return;
        }
        setOpen(false);
        setCheck(null);
        setVesselName('');
        setLabel('');
        setNotes('');
        /*
          Every field that describes the LAST vessel, not the next one. A typed length
          left behind is the worst of them: reopening the sheet for a different hull
          would pre-fill somebody else's measurement and write it on save — which is
          inventing a length (invariant 2) by way of a stale text box. The suggestion
          and the occupancy describe the last set of dates and are equally stale.
        */
        setLengthInput('');
        setSuggestion(null);
        setOccupancy(null);
        return;
      }
      setSaveError(res.error);
    });
  }

  // The button stays what it is while the sheet is open. It used to turn into a filled
  // "Close", which sat in the hero at title size and read as the page's main action;
  // the sheet has its own Cancel, and the overlay already covers this one.
  return (
    <>
      <button
        className="btn primary"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        + New booking
      </button>
      {open && <>
      <div className="overlay" onClick={() => setOpen(false)} />
      <aside className="panel-sheet" role="dialog" aria-modal="true" aria-label="New booking">
        <h2>New booking</h2>

        <div className="field">
          <label>Kind</label>
          <div className="segmented">
            {(['vessel', 'event', 'closure'] as BookingKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'on' : ''}
                onClick={() => setKind(k)}
              >
                {k === 'vessel' ? 'Vessel' : k === 'event' ? 'Event' : 'Closure'}
              </button>
            ))}
          </div>
        </div>

        {kind === 'vessel' ? (
          <div className="field">
            <label htmlFor="v">Vessel</label>
            <div style={{ flex: 1 }}>
              <input
                id="v"
                list="vessel-list"
                value={vesselName}
                placeholder="Start typing a vessel name"
                /*
                  Clearing the length here is the whole point of it being here.

                  It describes the hull named in this field, so changing the name
                  strands it: type "R/V A", type 77, then retype the name as "R/V B",
                  and the form asserted 77ft for a vessel nobody measured — and SAVED
                  it, because createBooking writes wherever length_ft is null. That is
                  inventing a length (invariant 2) by way of a stale text box, and it
                  corrupts the one column the fit check reads.
                */
                onChange={(e) => { setVesselName(e.target.value); setLengthInput(''); }}
              />
              <datalist id="vessel-list">
                {(vessels ?? []).map((v) => <option key={v.id} value={v.name} />)}
              </datalist>
              {vessel?.lengthFt != null && (
                <div className="sub-hint">{vessel.lengthFt}ft on record</div>
              )}
              {isNewVessel && (
                <div className="sub-hint">
                  New vessel &mdash; saving adds it to the register.
                </div>
              )}
              {/*
                The gap-closing control, and the reason this form exists twice over.
                It is deliberately here rather than only on the Vessels page: this is
                the moment the number is in front of somebody, and the register page is
                a queue of 398 rows nobody volunteers for. Blank is a complete answer.
              */}
              {asksForLength && (
                <div className="lenask">
                  <label htmlFor="vl">Length</label>
                  <input
                    id="vl"
                    inputMode="numeric"
                    value={lengthInput}
                    placeholder="—"
                    aria-label="Vessel length in feet, optional"
                    onChange={(e) => setLengthInput(e.target.value)}
                  />
                  <span className="unit">ft</span>
                  <span className="sub-hint">
                    {parsedLength.ok
                      ? 'Optional. Recording it checks this berth, and every future one.'
                      : parsedLength.error}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="l">Description</label>
            <input
              id="l"
              value={label}
              placeholder={kind === 'event' ? 'e.g. Community sail day' : 'e.g. Float rebuild - no usage permitted'}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="b">Berth</label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <select
              id="b"
              value={berthId}
              onChange={(e) => { setBerthId(e.target.value); setSuggestion(null); }}
            >
              {berths.map((b) => {
                const c = choices.find((x) => x.berthId === b.id);
                return (
                  <option key={b.id} value={b.id}>
                    {c
                      ? c.optionLabel
                      : `${b.name}${b.lengthFt != null ? ` — ${b.lengthFt}ft` : ' — pooled'}`}
                  </option>
                );
              })}
            </select>
            <div className="suggestrow">
              <button type="button" className="btn" onClick={findBerth} disabled={!occupancy}>
                Find me a berth
              </button>
              {suggestion && <span className="sub-hint">{suggestion}</span>}
            </div>
          </div>
        </div>

        {/*
          `field dates` / `span` / `to`, the same markup the edit panel uses — not an
          inline-styled div, which is what this was.

          The classes are not decoration. `.span` carries `min-width: 0`, without which a
          flex item cannot shrink below its content: two 141px date inputs, the word
          between them and their gaps come to 309px at EVERY width, so on a 375px phone
          the row ran 71px past the sheet and the end date was unreachable without
          scrolling sideways inside the dialog. And `.field.dates` has a 520px breakpoint
          that stacks the pair under its label, which an inline style cannot receive.

          It is the same fault as the 186px of panel overflow fixed earlier today,
          surviving on the one row that had opted out of the stylesheet. The edit panel
          was always correct; this is the panel behind the page's one filled button.
        */}
        <div className="field dates">
          <label htmlFor="s">Dates</label>
          <div className="span">
            {/* Named individually: the visible label says "Dates" for both, so without
                these a screen reader announces the first as "Dates" and the second as
                its own value. The move panel already does this. */}
            <input id="s" type="date" value={start} min={minDate} max={maxDate}
                   aria-label="Start date"
                   onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
            <span className="to">to</span>
            <input type="date" value={end} min={start} max={maxDate}
                   aria-label="End date"
                   onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        {/* What the coordinator knows and the schedule cannot hold: shore power, crane
            reach, who is arriving at 0600 (DECISIONS 22). The column, the query boundary
            and this action's parameter all already carried it; nothing wrote to it. */}
        <div className="field">
          <label htmlFor="n">Note</label>
          <textarea
            id="n" rows={3} value={notes}
            placeholder="Optional — anything the schedule cannot hold"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <Verdict check={check} checking={checking} kind={kind} />

        {saveError && <p className="verdict stop" style={{ marginTop: 8 }}>{saveError}</p>}

        <div className="actions">
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {pending ? 'Saving…' : 'Save booking'}
          </button>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          {disabledReason && <span className="why">{disabledReason}</span>}
        </div>
      </aside>
      </>}
    </>
  );
}

function Verdict({
  check,
  checking,
  kind,
}: {
  check: CheckResult | null;
  checking: boolean;
  kind: BookingKind;
}) {
  if (checking && !check) return <p className="verdict idle">Checking…</p>;
  if (!check) return null;

  return (
    <div className="verdictbox">
      {check.conflicts.length > 0 ? (
        <p className="verdict stop">
          <b>Blocked — berth already occupied.</b>{' '}
          {check.conflicts.map((c) => `${c.label} holds it ${formatSpanFull(c.startDate, c.endDate)}`).join('; ')}.
          The database will refuse this write.
        </p>
      ) : (
        <p className="verdict clear"><b>Berth is clear</b> for these dates.</p>
      )}

      {/*
        One line per clash rather than one folded line with a count: each is a different
        pair of berths on different days, so they are distinct questions — the same
        reason review never folds conflicts (lib/review).

        The two wordings are the feature. A single shared day is exactly how a berth
        shift looks in a schedule that records whole days, so it is put as a question;
        two days is a statement, because no shift explains it.
      */}
      {check.vesselClashes.map((c) => (
        <p className="verdict warn" key={c.id}>
          {c.sharedDays === 1 ? (
            <>
              <b>Check — moving berth on {c.sharedStart}?</b>{' '}
              This vessel is also booked at {c.berthName}, {formatSpanFull(c.startDate, c.endDate)}, and{' '}
              {c.sharedStart} is the only day the two share. If it is not a shift between
              berths that day, one of the two is wrong.
            </>
          ) : (
            <>
              <b>Warning — this vessel is booked elsewhere.</b>{' '}
              It is also at {c.berthName}, {formatSpanFull(c.startDate, c.endDate)} — {c.sharedDays} days
              in common, and one hull cannot be in two places.
            </>
          )}{' '}
          This does not stop you saving.
        </p>
      ))}

      {kind === 'vessel' && check.fit && check.fit.verdict !== 'fits' && (
        <p className="verdict warn">
          <b>{check.fit.verdict === 'too_long' ? 'Warning — does not fit.' : 'Warning — fit unverified.'}</b>{' '}
          {check.fit.reason} This does not stop you saving.
        </p>
      )}
      {kind === 'vessel' && check.fit?.verdict === 'fits' && (
        <p className="verdict clear">{check.fit.reason}</p>
      )}
    </div>
  );
}
