'use client';

import { useMemo, useState } from 'react';
import VesselLengthInput from './VesselLengthInput';
import type { VesselRow } from '../db/queries';

/**
 * The register, ordered by how many bookings each missing length is blocking.
 *
 * It used to render all 418 rows, which made the page 21,713px tall — 24 screens — and
 * put the page at odds with its own argument. The whole point of the ordering is that
 * the first handful carry most of the value: ten lengths cover half the schedule. So it
 * shows the head of the list and keeps the tail one click away.
 *
 * Client-side, because the two things you do here — filter to a hull you have the
 * measurement for, and open the rest — are both instant and neither is worth a round
 * trip or a URL.
 */
const HEAD = 25;

export default function VesselTable({ vessels }: { vessels: VesselRow[] }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vessels;
    return vessels.filter((v) => v.canonicalName.toLowerCase().includes(q));
  }, [vessels, query]);

  // Filtering is a search: showing 25 of someone's matches would hide the one they want.
  const searching = query.trim() !== '';
  const shown = all || searching ? filtered : filtered.slice(0, HEAD);
  const hidden = filtered.length - shown.length;

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
            : `${shown.length} of ${vessels.length}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="empty">No vessel matches “{query.trim()}”.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Vessel</th>
              <th style={{ width: 110 }}>Length</th>
              <th style={{ width: 92, textAlign: 'right' }}>Bookings</th>
              <th style={{ width: 74, textAlign: 'right' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.canonicalName}
                  {v.operator && <span className="sub-note">{v.operator}</span>}
                  {v.loaFt != null && v.lengthFt != null && v.loaFt !== v.lengthFt && (
                    <span
                      className="flag"
                      title="The source states two different lengths for this vessel. Both are kept; neither is silently chosen."
                    >
                      source also says LOA {v.loaFt}&prime;
                    </span>
                  )}
                </td>
                <td>
                  <VesselLengthInput
                    vesselId={v.id}
                    lengthFt={v.lengthFt}
                    bookingCount={v.bookingCount}
                  />
                </td>
                <td className="vnum">{v.bookingCount}</td>
                {/* The year alone answers what this column is for — is this hull still
                    in use, or is it history that needs no measuring. */}
                <td className="vyear">{v.lastSeen ? v.lastSeen.slice(0, 4) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hidden > 0 && (
        <button className="btn vmore" onClick={() => setAll(true)}>
          Show the remaining {hidden.toLocaleString()}
        </button>
      )}
    </div>
  );
}
