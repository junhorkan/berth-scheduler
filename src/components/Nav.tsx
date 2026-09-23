import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSummary } from '../db/queries';

export const SITE_NAME = 'Harborview Dock Schedule';

/**
 * The masthead: a small top row, then the page says what it is.
 *
 * The top row holds the small things — a way back to the board when you are not on
 * it, the search box, and the three tabs. Under it, one big line says what this page
 * is, one small line says what it is for or what it holds right now, and on the board
 * the one action the tool exists for sits beneath both. The shape is the reference
 * site's (DECISIONS 19 and 24): nothing is small, the primary action cannot be
 * missed, and a first-time visitor is told what this is before seeing anything else.
 * None of it is a page about the project; invariant 9 holds.
 *
 * `search` and `check` are destinations, not tabs: they leave all three tab links
 * unhighlighted, because neither page belongs to a section of the app.
 */
export default async function Nav({
  current,
  title,
  tagline,
  actions,
  query = '',
}: {
  current: 'board' | 'vessels' | 'review' | 'search';
  /** The page's own name. The board is the site, so it takes the site's. */
  title?: string;
  /** One line under the title: what the page is for, or what it holds right now. */
  tagline?: ReactNode;
  /** The page's primary action, if it has one. Only the board does. */
  actions?: ReactNode;
  query?: string;
}) {
  const summary = await getSummary();
  const home = current === 'board';

  return (
    <header className="masthead">
      <div className="topbar">
        {!home && <Link className="home" href="/">&lsaquo; {SITE_NAME}</Link>}
        <span className="spacer" />
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
          <Link href="/" aria-current={current === 'board' ? 'page' : undefined}>Board</Link>
          <Link href="/vessels" aria-current={current === 'vessels' ? 'page' : undefined}>Vessels</Link>
          <Link href="/review" aria-current={current === 'review' ? 'page' : undefined}>
            Review
            {summary.openReviewItems > 0 && <span className="count">{summary.openReviewItems}</span>}
          </Link>
        </nav>
      </div>

      <div className="hero">
        <h1>{title ?? SITE_NAME}</h1>
        {tagline && <p className="tagline">{tagline}</p>}
        {actions && <div className="heroactions">{actions}</div>}
      </div>
    </header>
  );
}
