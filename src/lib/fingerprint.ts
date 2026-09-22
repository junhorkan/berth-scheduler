/**
 * A schedule, reduced to one short hash per month, so two can be compared without
 * shipping either.
 *
 * /check used to say a workbook "matches, figure for figure" after comparing four totals.
 * A reviewer swapped two bookings' dates on the 2015 sheet and every total stayed the
 * same, so the page called a different schedule identical. Now both sides hash every
 * stay — berth, kind, status, name and dates — month by month, and every vessel's name
 * and length: equal hashes mean the same schedule, and a differing month says where to
 * look. The server sends about 270 short strings instead of 2,031 rows.
 *
 * The hash (cyrb53) is not cryptographic and does not need to be: nobody is being kept
 * out, a person is being told whether their file changed. Pure: no database, no React.
 */

export type Stay = { berth: string; kind: string; status: string; label: string; start: string; end: string };
export type Registered = { name: string; lengthFt: number | null };

/** Month (`YYYY-MM`, by the month a stay starts) to hash, plus `vessels` for the register. */
export type Fingerprint = Record<string, string>;

export const VESSELS_KEY = 'vessels';

function cyrb53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Order-free: the lines are sorted, so neither side's row order matters. */
const hashLines = (lines: string[]) => cyrb53(lines.sort().join('\n'));

export function fingerprint(stays: Stay[], vessels: Registered[]): Fingerprint {
  const byMonth = new Map<string, string[]>();
  for (const s of stays) {
    const month = s.start.slice(0, 7);
    const line = [s.berth, s.kind, s.status, s.label, s.start, s.end].join('\t');
    const lines = byMonth.get(month);
    if (lines) lines.push(line); else byMonth.set(month, [line]);
  }
  const out: Fingerprint = {};
  for (const [month, lines] of byMonth) out[month] = hashLines(lines);
  out[VESSELS_KEY] = hashLines(vessels.map((v) => `${v.name}\t${v.lengthFt ?? ''}`));
  return out;
}

/** The keys whose hashes differ, including any present on only one side, in order. */
export function differences(a: Fingerprint, b: Fingerprint): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}
