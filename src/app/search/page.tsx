import Nav from '../../components/Nav';
import { searchBookings } from '../../db/queries';
import {
  groupHits, isSearchable, normalizeQuery, formatSpan, hitHref,
  MIN_QUERY_LENGTH, HITS_PER_GROUP,
} from '../../lib/search';
import type { SearchGroup } from '../../lib/search';
import { MONTH_NAMES } from '../../lib/nav';
import type { BookingKind } from '../../domain/types';

// A cached schedule is a wrong schedule.
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; exp?: string }>;
}) {
  const sp = await searchParams;
  const raw = sp.q ?? '';
  const query = normalizeQuery(raw);
  const expanded = sp.exp ?? null;

  // An empty or one-character query is not an error, so it does not read as one — the
  // page says what it searches instead of showing zero results. No year range is
  // named: the window is whatever is on the schedule (invariant 7), so a sentence that
  // quoted one would be wrong the day someone books outside it.
  if (!isSearchable(query)) {
    return (
      <main className="shell">
        <Nav
          current="search"
          query={raw}
          title="Search"
          tagline="Find anything that occupies a berth, across every year on the schedule."
        />
        <div className="panel">
          <p style={{ margin: 0 }}>
            Vessels by name, non-vessel events such as <i>Community sail day</i>, and berth
            closures such as <i>Dock maintenance</i>. The board shows one month at a time;
            this searches all of them at once.
            {query.length > 0 && (
              <> Enter at least {MIN_QUERY_LENGTH} characters &mdash; <b>{query}</b> is too short
              to narrow anything down.</>
            )}
          </p>
        </div>
      </main>
    );
  }

  const { hits, truncated } = await searchBookings(query);
  const groups = groupHits(hits, query);

  const tagline = groups.length === 0 ? (
    <>Nothing on the schedule matches <b>{query}</b>.</>
  ) : (
    <>
      <b>{hits.length.toLocaleString()}</b> booking{hits.length === 1 ? '' : 's'} matching{' '}
      <b>{query}</b>, across {groups.length}{' '}
      {groups.length === 1 ? 'vessel or event' : 'vessels and events'}.
    </>
  );

  return (
    <main className="shell">
      <Nav current="search" query={raw} title="Search" tagline={tagline} />

      {groups.length === 0 && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            Searching vessel names, event labels, and closure notes. Cancelled bookings are
            not included.
          </p>
        </div>
      )}
      {truncated && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            Showing the {hits.length.toLocaleString()} most recent matches only. Narrow the
            search to see older ones.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <Group
          key={group.key}
          group={group}
          query={query}
          expanded={expanded === group.key}
        />
      ))}
    </main>
  );
}

function Group({
  group, query, expanded,
}: {
  group: SearchGroup; query: string; expanded: boolean;
}) {
  const shown = expanded ? group.hits : group.hits.slice(0, HITS_PER_GROUP);
  const hidden = group.bookingCount - shown.length;
  const q = encodeURIComponent(query);

  return (
    <section className="sgroup">
      <div className="shead">
        <b>{group.name}</b>
        <span className={`skind ${group.kind}`}>{KIND_LABEL[group.kind]}</span>
        <span className="spacer" />
        <span className="smeta">
          {group.bookingCount.toLocaleString()} booking{group.bookingCount === 1 ? '' : 's'}
          {' · '}
          {group.firstYear === group.lastYear
            ? group.firstYear
            : `${group.firstYear}–${group.lastYear}`}
        </span>
      </div>

      <table className="tbl shits">
        <tbody>
          {shown.map((hit) => (
            <tr key={hit.id}>
              <td className="smonth">
                {MONTH_NAMES[Number(hit.startDate.slice(5, 7)) - 1].slice(0, 3)}{' '}
                {hit.startDate.slice(0, 4)}
              </td>
              <td className="sberth">{hit.berthName}</td>
              <td className="sspan">{formatSpan(hit.startDate, hit.endDate)}</td>
              <td>
                {hit.status === 'conflict_unresolved' && (
                  <span className="flag">unresolved conflict</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <a
                  className="sjump"
                  href={hitHref(hit)}
                  aria-label={`Show ${group.name} on the board, ${formatSpan(hit.startDate, hit.endDate)} ${hit.startDate.slice(0, 4)}, ${hit.berthName}`}
                >
                  Show on board &rarr;
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hidden > 0 && (
        <a className="smore" href={`/search?q=${q}&exp=${encodeURIComponent(group.key)}`}>
          Show all {group.bookingCount.toLocaleString()} &mdash; {hidden.toLocaleString()} more
        </a>
      )}
      {expanded && group.bookingCount > HITS_PER_GROUP && (
        <a className="smore" href={`/search?q=${q}`}>Show fewer</a>
      )}
    </section>
  );
}

const KIND_LABEL: Record<BookingKind, string> = {
  vessel: 'vessel',
  event: 'event',
  closure: 'closure',
};
