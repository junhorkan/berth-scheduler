/**
 * A fraction, said the way a person would say it.
 *
 * The Vessels page used to explain itself with four figures in one sentence ("398 of 418
 * vessels ... 1,920 of 1,974 bookings ... 1,002 of them"), which is arithmetic for the
 * reader rather than a reason to act. What the line has to convey is one proportion —
 * the first ten rows are worth about half the work — so it states that, in words.
 *
 * Rounds DOWN to the nearest plain fraction, so the words never overclaim: 0.508 is
 * "half", 0.49 is "a third". Below a quarter it returns null, and the caller says
 * nothing, because "a small share" is not a reason to start anywhere.
 *
 * Pure: no database, no React.
 */
const STEPS: [number, string][] = [
  [1, 'all'],
  [0.95, 'nearly all'],
  [0.75, 'three quarters'],
  [2 / 3, 'two thirds'],
  [0.5, 'half'],
  [1 / 3, 'a third'],
  [0.25, 'a quarter'],
];

export function shareInWords(part: number, whole: number): string | null {
  if (!(whole > 0) || !(part > 0)) return null;
  const r = part / whole;
  for (const [floor, words] of STEPS) if (r >= floor) return words;
  return null;
}
