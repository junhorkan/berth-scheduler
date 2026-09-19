import { getSummary } from '../db/queries';

export default async function Nav({ current }: { current: 'board' | 'vessels' | 'review' }) {
  const summary = await getSummary();
  return (
    <header className="masthead">
      <h1>Harborview Marine Research Center</h1>
      <span className="sub">Dock Schedule</span>
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
