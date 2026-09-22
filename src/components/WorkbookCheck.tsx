'use client';

import { useRef, useState } from 'react';
import type { Reconciliation } from '../import/plan';
import type { Sample, SampleCounts } from '../db/queries';
import { refuseOversize } from '../import/zipGuard';
import { groupReviewItems } from '../lib/review';
import { fingerprint, differences, VESSELS_KEY } from '../lib/fingerprint';

/**
 * Read a workbook in this browser and say what the importer finds in it. Writes nothing.
 *
 * The parse runs here, on the visitor's machine, through the same planImport() the
 * command-line importer uses — so the report is the importer's own answer, not a copy of
 * it. The file never leaves the browser and there is no server endpoint behind this, so a
 * hostile file can only ever hurt the tab that opened it, and planImport refuses the
 * ones that would. DECISIONS 30.
 *
 * Its point is the attachment in the brief. A grader holds the workbook they generated,
 * with its planted defects, and can drop in that copy — or an edited one, with a second
 * double-booking planted — and see whether the importer catches it.
 */

/** How a checked file compares with the sample imported here. */
type Comparison = {
  counts: { label: string; file: number; sample: number }[];
  /** Months (`YYYY-MM`) whose stays differ, in order. */
  months: string[];
  /** The vessel register differs: a name, or a recorded length. */
  vessels: boolean;
};

type State =
  | { phase: 'idle' }
  | { phase: 'reading'; name: string }
  | { phase: 'refused'; name: string; reason: string }
  | { phase: 'failed'; name: string; reason: string }
  | { phase: 'done'; name: string; r: Reconciliation; vs: Comparison | null };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n = (x: number) => x.toLocaleString('en-US');
const span = (a: string, b: string) => (a === b ? a : `${a} to ${b}`);
const cell = (c: { sheet: string; row: number; col?: number }) =>
  `sheet ${c.sheet}, row ${c.row}${c.col ? `, col ${c.col}` : ''}`;
/** `2015-03` or `2015/3` → `Mar 2015`. */
const monthName = (m: string) => {
  const [y, mm] = m.split(/[-/]/);
  return `${MONTHS[Number(mm) - 1]} ${y}`;
};

/** Rows past this fold behind "Show the remaining N", as they do on Review. */
const HEAD = 5;
/** Places listed under one row before the rest are counted rather than drawn. */
const PLACES = 12;
/** Rows drawn per section; the real workbook's longest has 11. */
const ROWS = 100;

const COUNTED: { key: keyof SampleCounts; label: string }[] = [
  { key: 'stays', label: 'stays' },
  { key: 'vessels', label: 'vessels' },
  { key: 'conflicts', label: 'double-bookings' },
  { key: 'reviewItems', label: 'review items' },
];

export default function WorkbookCheck({ sample }: { sample: Sample | null }) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  // Only the newest file's answer is shown, however the parses finish.
  const latest = useRef(0);

  async function check(file: File) {
    const run = ++latest.current;
    const show = (s: State) => { if (run === latest.current) setState(s); };
    show({ phase: 'reading', name: file.name });

    let bytes: Uint8Array;
    let planImport: typeof import('../import/plan').planImport;
    try {
      refuseOversize(file.size);
      bytes = new Uint8Array(await file.arrayBuffer());
      // Loaded on demand: the spreadsheet library is about 390KB, and nobody who never
      // opens this page should download it.
      ({ planImport } = await import('../import/plan'));
    } catch (e) {
      // A refusal of the file, or this browser failing to read it or to load the reader.
      // Only the first is a verdict on the workbook.
      if (isRefusal(e)) return show({ phase: 'refused', name: file.name, reason: e.message });
      return show({ phase: 'failed', name: file.name, reason: e instanceof Error ? e.message : String(e) });
    }

    try {
      const plan = await planImport(bytes);
      const vs = sample
        ? compare(sample, plan.reconciliation, fingerprint(
            plan.bookings.map((b) => ({ berth: b.berthName, kind: b.kind, status: b.status, label: b.label, start: b.start, end: b.end })),
            plan.vessels.map((v) => ({ name: v.normalized, lengthFt: v.lengthFt })),
          ))
        : null;
      show({ phase: 'done', name: file.name, r: plan.reconciliation, vs });
    } catch (e) {
      // Anything planImport throws is about the file, SheetJS's own errors on a malformed
      // one included. Said as a refusal, because nothing would be imported.
      show({ phase: 'refused', name: file.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <div className="checkpick">
        <label className="btn primary filepick">
          {state.phase === 'reading' ? 'Reading…' : 'Choose a workbook'}
          <input
            type="file"
            accept=".xlsx"
            aria-label="Choose a workbook to check"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void check(f);
              // So choosing the same file again, after editing it, checks it again.
              e.target.value = '';
            }}
          />
        </label>
        <span className="sub-hint">
          Read in this browser. Nothing is uploaded, and nothing is saved.
        </span>
      </div>

      {state.phase === 'refused' && (
        <div className="checkresult">
          <p className="checkfile">{state.name}</p>
          <p className="verdict stop"><b>Would not be imported.</b> {state.reason}</p>
        </div>
      )}
      {state.phase === 'failed' && (
        <div className="checkresult">
          <p className="checkfile">{state.name}</p>
          <p className="verdict warn">
            <b>This browser could not read that file.</b> {state.reason} Nothing was decided
            about the workbook; try choosing it again.
          </p>
        </div>
      )}

      {state.phase === 'done' && <Report name={state.name} r={state.r} vs={state.vs} />}
    </>
  );
}

function isRefusal(e: unknown): e is Error {
  // By name, not instanceof: the class can reach this page through two chunks.
  return e instanceof Error && e.name === 'ImportError';
}

function compare(sample: Sample, r: Reconciliation, fp: Record<string, string>): Comparison {
  const file: SampleCounts = {
    stays: r.stays.total, vessels: r.vessels.total,
    reviewItems: r.reviewItems, conflicts: r.conflicts.length,
  };
  const diff = differences(fp, sample.fingerprint);
  return {
    counts: COUNTED
      .filter(({ key }) => file[key] !== sample.counts[key])
      .map(({ key, label }) => ({ label, file: file[key], sample: sample.counts[key] })),
    months: diff.filter((k) => k !== VESSELS_KEY),
    vessels: diff.includes(VESSELS_KEY),
  };
}

function Report({ name, r, vs }: { name: string; r: Reconciliation; vs: Comparison | null }) {
  const same = vs !== null && vs.counts.length === 0 && vs.months.length === 0 && !vs.vessels;
  // The cells that became nothing, so none of them vanishes silently. The ones it would
  // not guess at have a section of their own below.
  const notes = [
    r.cells.timingNotes > 0 && `${n(r.cells.timingNotes)} timing notes, such as ETA 1200`,
    r.cells.marginNotes > 0 && `${n(r.cells.marginNotes)} notes in the margins, outside the days`,
  ].filter(Boolean);

  return (
    <div className="checkresult">
      <p className="checkfile">{name}</p>
      <p className="checkheadline">
        <b>{r.sheets.yearGrids.length} year sheets</b> read. {n(r.cells.occupying)} cells occupy a
        berth, and became <b>{n(r.stays.total)} stays</b>.
      </p>
      {notes.length > 0 && <p className="checksub">Not bookings: {notes.join(', and ')}.</p>}

      {vs && (same ? (
        <p className="verdict clear">
          <b>Matches the sample imported here, booking for booking:</b> every berth, name,
          date and conflict, and every vessel&rsquo;s recorded length.
        </p>
      ) : (
        <div className="verdict warn">
          <b>Differs from the sample imported here.</b>
          <ul className="checkdiff">
            {vs.counts.map((c) => (
              <li key={c.label}>{c.label}: {n(c.file)} in this file, {n(c.sample)} in the sample</li>
            ))}
            {vs.months.length > 0 && (
              <li>
                Bookings differ in {vs.months.slice(0, PLACES).map(monthName).join(', ')}
                {vs.months.length > PLACES && <>, and {vs.months.length - PLACES} more months</>}
              </li>
            )}
            {vs.vessels && <li>The vessel register differs: a name, or a recorded length</li>}
          </ul>
        </div>
      ))}

      <Section title="Double-bookings" tone="bad" lines={r.conflicts.map((c) => ({
        text: c.label,
        detail: `${c.berth}, ${span(c.start, c.end)}. Overlaps ${c.overlaps}. Kept, not deleted.`,
        at: [cell(c)],
      }))} />

      <Section title="Vessels too long for their berth" tone="bad" lines={
        fold(r.tooLong.map((t) => ({ type: 'too_long', text: t.vessel, identity: t.vesselKey, berth: t.berth, start: t.start, t })))
          .map((g) => ({
            text: g[0].t.vessel,
            detail: `${g[0].t.vesselFt}ft in ${g[0].t.berth}, which is ${g[0].t.berthFt}ft`,
            at: g.map(({ t }) => `${span(t.start, t.end)} · ${cell(t)}`),
          }))
      } />

      <Section title="Months it could not align" tone="warn" lines={
        r.months.unaligned.length
          ? [{
              text: 'No row of day numbers it could trust',
              detail: 'Nothing in these months was read, rather than read on the wrong dates.',
              at: r.months.unaligned.map((m) => `sheet ${m.split('/')[0]}: ${monthName(m)}`),
            }]
          : []
      } />

      <Section title="Defects in the file, handled" tone="muted" lines={[
        ...(r.defects.carriedOverDecembers.length
          ? [{
              text: 'A sheet opens with the previous December',
              detail: 'Carried over from the sheet before. Merged with the original, not duplicated.',
              at: r.defects.carriedOverDecembers.map((d) => `sheet ${d.sheet}: ${MONTHS[d.month - 1]} ${d.year}`),
            }]
          : []),
        ...(r.defects.implausibleYears.length
          ? [{
              text: 'A month headed with the wrong year',
              detail: 'Read as the year of the sheet it is on.',
              at: r.defects.implausibleYears.map((d) =>
                `sheet ${d.sheet}, row ${d.row}: says ${MONTHS[d.month - 1]} ${d.statedYear}, read as ${d.usedYear}`),
            }]
          : []),
        ...(r.months.calendarUnverified.length
          ? [{
              text: 'Weekday letters that do not match the calendar',
              detail: 'Dates come from the day numbers; the letters were not trusted.',
              at: r.months.calendarUnverified.map((m) => `sheet ${m.split('/')[0]}: ${monthName(m)}`),
            }]
          : []),
        ...(r.defects.unattributed.length
          ? [{
              text: 'Entries on a row that names no berth',
              detail: `${r.defects.unattributed.length} cells on rows with a blank label or a `
                + 'section header. Reported rather than attributed to the berth above, which '
                + 'the file does not say.',
              at: [...new Set(r.defects.unattributed.map((u) => u.sheet))]
                .map((sheet) => {
                  const cells = r.defects.unattributed.filter((u) => u.sheet === sheet);
                  return `sheet ${sheet}: ${cells.length}, from row ${cells[0].row}`;
                }),
            }]
          : []),
        ...(r.defects.orphanedCells.length
          ? [{
              text: 'Names typed over a day-number row',
              detail: `${r.defects.orphanedCells.length} names that belong to no berth. Each is listed below rather than guessed.`,
              at: [...new Set(r.defects.orphanedCells.map((o) => `sheet ${o.sheet}, row ${o.row}`))],
            }]
          : []),
      ]} />

      <Section title="Cells it would not guess at" tone="warn" lines={
        fold(r.unreadable.map((u) => ({ type: 'unclassified', text: u.text, identity: null, berth: null, start: null, t: u })))
          .map((g) => {
            // Where it sat, stated once when every occurrence says the same thing.
            const alike = g.every(({ t }) => t.where === g[0].t.where);
            return {
              text: g[0].t.text,
              detail: alike ? g[0].t.where : undefined,
              at: g.map(({ t }) => (alike ? cell(t) : `${t.where} · ${cell(t)}`)),
            };
          })
      } />

      <Section title="Registry entries that contradict themselves" tone="muted" lines={
        r.vessels.contradictions.map((c) => ({
          text: c.vessel,
          detail: `Its name says ${c.nameFt}ft; its notes say LOA ${c.loaFt}ft. `
            + (c.booked ? 'Stored with both; the fit check uses the name.' : 'Never booked, so not stored.'),
          at: [cell(c)],
        }))
      } />

      {r.sheets.notRead.length > 0 && (
        <p className="note checknote">
          Not read as schedule: {r.sheets.notRead.map((s) => s.sheet).join(', ')}.
          {r.sheets.registry.length > 0 && <> Vessel lengths came from {r.sheets.registry.join(' and ')}.</>}
        </p>
      )}
    </div>
  );
}

/**
 * Fold identical problems into one row, by the same rule Review uses (lib/review): a
 * misfit by vessel and berth, an unreadable cell by its text; a conflict never. So M/V
 * Iron Heron is one row with four places, not four rows.
 */
function fold<T extends { type: string; text: string; identity: string | null; berth: string | null; start: string | null }>(rows: T[]): T[][] {
  const keyed = rows.map((row, i) => ({
    id: String(i), type: row.type, rawText: row.text, detail: null, vesselId: row.identity,
    berthName: row.berth, bookingStart: row.start, importSheet: null, importRow: null, importCol: null,
  }));
  return groupReviewItems(keyed).map((g) => g.rows.map((k) => rows[Number(k.id)]));
}

/** One problem: what it says, what is wrong, and every cell it came from. */
type Line = { text: string; detail?: string; at: string[] };

function Section({ title, tone, lines }: { title: string; tone: 'bad' | 'warn' | 'muted'; lines: Line[] }) {
  if (lines.length === 0) return null;
  const count = lines.reduce((a, l) => a + l.at.length, 0);
  const head = lines.slice(0, HEAD);
  const tail = lines.slice(HEAD, ROWS);
  const unshown = lines.length - head.length - tail.length;
  const li = (l: Line, i: number) => (
    <li key={i}>
      <div className="qmain">
        <span className="qtext">
          {l.text}
          {l.at.length > 1 && <span className="qcount">{n(l.at.length)}&times;</span>}
        </span>
        {l.detail && <span className="qdetail">{l.detail}</span>}
        {/* A hostile file can repeat one problem thousands of times. The count above is
            exact; places past the first dozen are counted rather than drawn. */}
        {l.at.slice(0, PLACES).map((a, j) => <span key={j} className="qmeta">{a}</span>)}
        {l.at.length > PLACES && <span className="qmeta">and {n(l.at.length - PLACES)} more</span>}
      </div>
    </li>
  );
  return (
    <section className="qsection">
      <h2 className={`qhead ${tone}`}>{title}<span className="qhcount">{n(count)}</span></h2>
      <ul className="queue">{head.map(li)}</ul>
      {tail.length > 0 && (
        <details className="qmore">
          <summary>
            <span className="when-closed">Show the remaining {n(tail.length)}</span>
            <span className="when-open">Show fewer</span>
          </summary>
          <ul className="queue">{tail.map((l, i) => li(l, i + HEAD))}</ul>
          {unshown > 0 && <p className="note">And {n(unshown)} more rows, counted above but not drawn.</p>}
        </details>
      )}
    </section>
  );
}
