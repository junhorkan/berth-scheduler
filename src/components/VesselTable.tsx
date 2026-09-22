'use client';

import { useMemo, useState } from 'react';
import VesselLengthInput from './VesselLengthInput';
import type { VesselRow } from '../db/queries';

/**
 * The register, as work: the hulls whose missing length blocks the most bookings first.
 *
 * It began as a four-column table of all 418 rows, which made the page 21,713px tall —
 * 24 screens. Then 25 rows of it, each carrying an empty box, which is a wall. Then five
 * rows and a *Show the remaining 393*, which is a wall one click away. So it pages: a
 * category at a time, ten rows at a time, and the rest is a page forward rather than a
 * longer page. DECISIONS 23.
 *
 * Client-side, because the three things you do here — filter to a hull you have the
 * measurement for, turn a page, and look at what is already recorded — are instant, and
 * none is worth a round trip or a URL.
 */
type Category = 'missing' | 'recorded';

export default function VesselTable({ vessels, perPage }: { vessels: VesselRow[]; perPage: number }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('missing');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return vessels.filter((v) => v.canonicalName.toLowerCase().includes(q));
  }, [vessels, query]);

  const missing = useMemo(() => vessels.filter((v) => v.lengthFt == null), [vessels]);
  const recorded = useMemo(() => vessels.filter((v) => v.lengthFt != null), [vessels]);

  // Filtering is a search across the whole register, not inside a category: somebody
  // typing a name wants that hull, whichever list it happens to sit in.
  const searching = query.trim() !== '';
  const rows = searching ? filtered : category === 'missing' ? missing : recorded;

  // Clamped rather than stored: recording a length moves a row to the other category,
  // and the page you were on can stop existing under you.
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const shown = rows.slice(from, from + perPage);

  const show = (next: Category) => { setCategory(next); setPage(1); };

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
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
        />
        <span className="vcount">
          {searching ? `${filtered.length} of ${vessels.length}` : `${vessels.length} vessels`}
        </span>
      </div>

      {/*
        The two halves of the register, named on their own buttons: what still needs a
        length, and what already has one. While a filter is typed there is one list —
        the matches — so the buttons would be claiming a split that is not on screen.
      */}
      {!searching && recorded.length > 0 && (
        <div className="catrow" role="group" aria-label="Register category">
          <button
            type="button"
            className="catbtn"
            aria-pressed={category === 'missing'}
            onClick={() => show('missing')}
          >
            No length on record
          </button>
          <button
            type="button"
            className="catbtn"
            aria-pressed={category === 'recorded'}
            onClick={() => show('recorded')}
          >
            With a length recorded
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="empty">
          {searching ? `No vessel matches “${query.trim()}”.` : 'Nothing in this category.'}
        </p>
      ) : (
        <ul className="queue">
          {shown.map((v) => <VesselItem key={v.id} vessel={v} />)}
        </ul>
      )}

      {/* The count lives here, so a category's name is on its button and nowhere twice. */}
      {rows.length > 0 && (
        <nav className="pager" aria-label="Pages">
          {pages > 1 && (
            <button
              type="button"
              className="navbtn"
              onClick={() => setPage(current - 1)}
              disabled={current === 1}
              aria-label="Previous page"
            >
              &lsaquo;
            </button>
          )}
          <span className="prange">
            {(from + 1).toLocaleString()}&ndash;{(from + shown.length).toLocaleString()}
            {' of '}{rows.length.toLocaleString()}
          </span>
          {pages > 1 && (
            <button
              type="button"
              className="navbtn"
              onClick={() => setPage(current + 1)}
              disabled={current === pages}
              aria-label="Next page"
            >
              &rsaquo;
            </button>
          )}
        </nav>
      )}
    </div>
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
