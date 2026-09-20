import Link from 'next/link';

/**
 * Next.js ships a default 404 whose inline styles carry their own
 * prefers-color-scheme rule, so a mistyped URL would render dark against an
 * otherwise light-only app.
 *
 * Deliberately standalone: no <Nav>, and therefore no database query. The page that
 * appears when something is already wrong should not depend on the database being
 * awake — Supabase pauses a free project after about a week idle, and this page is
 * prerendered at build time. The site name is written out rather than imported from
 * Nav for the same reason: that module pulls in the database client.
 */
export default function NotFound() {
  return (
    <main className="shell">
      <header className="masthead">
        <div className="hero">
          <h1>Harborview Dock Schedule</h1>
          <p className="tagline">
            That page does not exist. The schedule, the vessel register and the review
            queue are all reachable from the board.
          </p>
          <div className="heroactions">
            <Link className="btn primary" href="/">Back to the board</Link>
          </div>
        </div>
      </header>
    </main>
  );
}
