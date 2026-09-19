'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { checkBookingAction, createBookingAction } from '../app/actions';
import type { BerthRow } from '../db/queries';
import type { CheckResult } from '../db/mutations';
import type { BookingKind } from '../domain/types';

/**
 * New booking, opening OVER the board rather than on its own page, so the grid stays
 * visible behind it.
 *
 * The verdict strip is the design argument made visible, and the two states are
 * deliberately not the same shape:
 *
 *   RED    a conflict. The database's exclusion constraint will refuse this write, so
 *          Save is disabled. There is no override.
 *   AMBER  a fit problem. Advisory only, and never blocks — because 97% of vessels
 *          have no recorded length, so blocking on it would make the tool unusable.
 *
 * The caption under Save always names which condition disabled it.
 */
export default function BookingPanel({
  berths,
  vessels,
  defaultDate,
}: {
  berths: BerthRow[];
  vessels: { id: string; name: string; lengthFt: number | null }[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BookingKind>('vessel');
  const [berthId, setBerthId] = useState(berths[0]?.id ?? '');
  const [vesselName, setVesselName] = useState('');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(defaultDate);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const vessel = vessels.find((v) => v.name.toLowerCase() === vesselName.trim().toLowerCase());
  const vesselId = kind === 'vessel' ? vessel?.id ?? null : null;
  const effectiveLabel = kind === 'vessel' ? vessel?.name ?? vesselName.trim() : label.trim();

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
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const result = await checkBookingAction({ berthId, vesselId, kind, start, end });
        if (mine === generation.current) setCheck(result);
      } finally {
        if (mine === generation.current) setChecking(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [open, berthId, vesselId, kind, start, end]);

  const needsVessel = kind === 'vessel' && !vessel;
  const missingLabel = effectiveLabel === '';
  const blocked = check ? !check.bookable : false;
  const canSave = !blocked && !missingLabel && !needsVessel && !pending;

  const disabledReason = blocked
    ? check?.blockedBecause ?? 'This berth is already occupied.'
    : needsVessel
      ? 'Pick a vessel from the list, or add it on the Vessels tab first.'
      : missingLabel
        ? 'Give this booking a name.'
        : null;

  function save() {
    setSaveError(null);
    startTransition(async () => {
      const res = await createBookingAction({
        berthId, vesselId, kind, label: effectiveLabel, start, end,
      });
      if (res.ok) {
        setOpen(false);
        setCheck(null);
        setVesselName('');
        setLabel('');
      } else {
        setSaveError(res.error);
      }
    });
  }

  if (!open) {
    return <button className="btn primary" onClick={() => setOpen(true)}>+ New booking</button>;
  }

  return (
    <>
      <button className="btn primary" onClick={() => setOpen(false)}>Close</button>
      <div className="overlay" onClick={() => setOpen(false)} />
      <aside className="panel-sheet" role="dialog" aria-label="New booking">
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
                onChange={(e) => setVesselName(e.target.value)}
              />
              <datalist id="vessel-list">
                {vessels.map((v) => <option key={v.id} value={v.name} />)}
              </datalist>
              {vessel && (
                <div className="sub-hint">
                  {vessel.lengthFt != null
                    ? `${vessel.lengthFt}ft on record`
                    : 'No length on record for this vessel'}
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
          <select id="b" value={berthId} onChange={(e) => setBerthId(e.target.value)}>
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.lengthFt != null ? ` — ${b.lengthFt}ft` : ' — pooled'}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="s">Dates</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
            <input id="s" type="date" value={start} min="1997-08-01" max="2035-12-31"
                   onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
            <span style={{ color: 'var(--ink-muted)' }}>to</span>
            <input type="date" value={end} min={start} max="2035-12-31"
                   onChange={(e) => setEnd(e.target.value)} />
          </div>
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
          {check.conflicts.map((c) => `${c.label} holds it ${c.startDate} to ${c.endDate}`).join('; ')}.
          The database will refuse this write.
        </p>
      ) : (
        <p className="verdict clear"><b>Berth is clear</b> for these dates.</p>
      )}

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
