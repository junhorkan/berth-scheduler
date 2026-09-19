import { getSummary } from '../db/queries';

/**
 * `search` is a destination, not a fourth tab: it leaves all three tab links
 * unhighlighted, because the results page belongs to no section of the app.
 */
export default async function Nav({
  current,
  query = '',
}: {
  current: 'board' | 'vessels' | 'review' | 'search';
  query?: string;
}) {
  const summary = await getSummary();
  return (
    <header className="masthead">
      <div className="brand">
        <h1>Harborview Marine Research Center</h1>
        <p className="tagline">Book a berth, check any date, and never double-book one.</p>
      </div>

      <form className="find" method="get" action="/search" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Find a vessel or event"
          aria-label="Find a vessel or event across all years"
        />
        <button type="submit">Find</button>
      </form>

      <nav className="tabs">
        <a href="/" aria-current={current === 'board' ? 'page' : undefined}>Board</a>
        <a href="/vessels" aria-current={current === 'vessels' ? 'page' : undefined}>Vessels</a>
        <a href="/review" aria-current={current === 'review' ? 'page' : undefined}>
          Review
          {summary.openReviewItems > 0 && <span className="count">{summary.openReviewItems}</span>}
        </a>
      </nav>
    </header>
  );
}
