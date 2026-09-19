/**
 * Next.js ships a default 404 whose inline styles carry their own
 * prefers-color-scheme rule, so a mistyped URL would render dark against an
 * otherwise light-only app.
 *
 * Deliberately standalone: no <Nav>, and therefore no database query. The page that
 * appears when something is already wrong should not depend on the database being
 * awake — Supabase pauses a free project after about a week idle, and this page is
 * prerendered at build time.
 */
export default function NotFound() {
  return (
    <main className="shell">
      <header className="masthead">
        <h1>Harborview Marine Research Center</h1>
      </header>

      <div className="panel" style={{ marginTop: 20 }}>
        <p style={{ margin: 0, fontSize: 16 }}>
          <b>That page does not exist.</b>
        </p>
        <p className="note" style={{ marginTop: 6 }}>
          The dock schedule, the vessel register and the review queue are all reachable
          from the board.
        </p>
        <p style={{ marginTop: 14 }}>
          <a className="btn primary" href="/">Back to the board</a>
        </p>
      </div>
    </main>
  );
}
