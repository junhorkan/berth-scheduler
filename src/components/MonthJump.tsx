'use client';

import { useRouter } from 'next/navigation';
import { MONTH_NAMES } from '../lib/nav';

/**
 * Year and month pickers that navigate the moment you choose.
 *
 * This replaced a label, two selects and a "Go" button. Choosing a month IS the
 * instruction; making someone confirm it was a control that existed only because the
 * form was plain HTML.
 */
export default function MonthJump({
  year, month, years,
}: {
  year: number; month: number; years: number[];
}) {
  const router = useRouter();
  const go = (y: number, m: number) => router.push(`/?y=${y}&m=${m}`);

  return (
    <div className="jump">
      <select
        aria-label="Jump to month"
        value={month}
        onChange={(e) => go(year, Number(e.target.value))}
      >
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <select
        aria-label="Jump to year"
        value={year}
        onChange={(e) => go(Number(e.target.value), month)}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
