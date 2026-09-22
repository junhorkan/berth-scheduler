'use client';

import { useMemo, useState } from 'react';
import VesselLengthInput from './VesselLengthInput';
import type { VesselRow } from '../db/queries';

/**
 * The register, as work: the hulls whose missing length blocks the most bookings first.
 *
 * It began as a four-column table of all 418 rows, which made the page 21,713px tall —
 * 24 screens — and put the page at odds with its own argument. Then 25 rows of it, which
 * is still a wall of near-identical rows each carrying an empty box. It is a queue, and
 * it now looks like one: the same row Review uses, five at a time, the category named
 * once above them with its count, and the measured hulls behind a button because they
 * are not the work.
 *
 * Client-side, because the three things you do here — filter to a hull you have the
 * measurement for, open the rest, and look at what is already recorded — are instant,
 * and none is worth a round trip or a URL.
 */
export default function VesselTable({ vessels, head }: { vessels: VesselRow[]; head: number }) {
  const [query, setQuery] = useState('');
  const [allMissing, setAllMissing] = useState(false);
  const [allRecorded, setAllRecorded] = useState(false);
  const [openRecorded, setOpenRecorded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vessels;
    return vessels.filter((v) => v.canonicalName.toLowerCase().includes(q));
  }, [vessels, query]);

  const missing = vessels.filter((v) => v.lengthFt == null);
  const recorded = vessels.filter((v) => v.lengthFt != null);
  // Filtering is a search across the whole register: it ignores the split, because
  // somebody typing a name wants that hull, not the category it happens to sit in.
  const searching = query.trim() !== '';

  // An empty register is a state, not a failed search, so it does not say
  // "No vessel matches" against a filter nobody typed.
  if (vessels.length === 0) {
    return (
      <div className="board">
        <p className="empty">Nothing on the register yet.</p>
      </div>
    );
  }

  return (
    <div className="board">
      <div className="vfilter">
        <input
          type="search"
          value={query}
          placeholder="Filter by name"
          aria-label="Filter vessels by name"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="vcount">
          {searching
            ? `${filtered.length} of ${vessels.length}`
            : `${vessels.length} vessels`}
        </span>
      </div>

      {searching ? (
        filtered.length === 0 ? (
          <p className="empty">No vessel matches “{query.trim()}”.</p>
        ) : (
          <ul className="queue">
            {filtered.map((v) => <VesselItem key={v.id} vessel={v} />)}
          </ul>
        )
      ) : (
        <>
          <Section
            title="No length on record"
            rows={missing}
            head={head}
            all={allMissing}
            onShowAll={() => setAllMissing(true)}
          />

          {recorded.length > 0 && (
            // Not the work: a length already recorded is a fit check that already
            // happens. Behind a button, like the History card on Review.
            <section className="qsection vrecorded">
              <button
                type="button"
                className="catbtn"
                aria-expanded={openRecorded}
                onClick={() => setOpenRecorded((o) => !o)}
              >
                With a length recorded
              </button>
              {openRecorded && (
                <Section
                  title="With a length recorded"
                  rows={recorded}
                  head={head}
                  all={allRecorded}
                  onShowAll={() => setAllRecorded(true)}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** One category: its name and count once, a few rows, and the rest one click away. */
function Section({
  title, rows, head, all, onShowAll,
}: {
  title: string; rows: VesselRow[]; head: number; all: boolean; onShowAll: () => void;
}) {
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, head);
  const hidden = rows.length - shown.length;
  return (
    <section className="qsection">
      <h2 className="qhead muted">
        {title}
        <span className="qhcount">{rows.length.toLocaleString()}</span>
      </h2>
      <ul className="queue">
        {shown.map((v) => <VesselItem key={v.id} vessel={v} />)}
      </ul>
      {hidden > 0 && (
        <button className="qmorebtn" onClick={onShowAll}>
          Show the remaining {hidden.toLocaleString()}
        </button>
      )}
    </section>
  );
}

/**
 * One hull, in the shape Review uses: what it is, a quiet line of what it is worth
 * measuring for, and the one control on the right.
 *
 * The bookings and the year were columns. Inline they say the same thing in words —
 * what a length here would unlock, and whether the hull is still around to measure.
 */
function VesselItem({ vessel: v }: { vessel: VesselRow }) {
  const meta = [
    v.bookingCount === 1 ? '1 booking' : `${v.bookingCount.toLocaleString()} bookings`,
    v.lastSeen ? `last ${v.lastSeen.slice(0, 4)}` : null,
    v.operator,
  ].filter(Boolean).join(' · ');

  return (
    <li>
      <div className="qmain">
        <span className="qtext">
          {v.canonicalName}
          {v.loaFt != null && v.lengthFt != null && v.loaFt !== v.lengthFt && (
            <span
              className="flag"
              title="The source states two different lengths for this vessel. Both are kept; neither is silently chosen."
            >
              source also says LOA {v.loaFt}&prime;
            </span>
          )}
        </span>
        <span className="qmeta">{meta}</span>
      </div>
      <div className="qact">
        <VesselLengthInput vesselId={v.id} lengthFt={v.lengthFt} bookingCount={v.bookingCount} />
      </div>
    </li>
  );
}
