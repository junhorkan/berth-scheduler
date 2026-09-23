/**
 * Reading a vessel length typed by a person.
 *
 * `Number()` is too generous for this field. It accepts `1e3` as 1000, `0x10` as 16,
 * `Infinity`, and a string of spaces as 0 — every one of them finite, several of them
 * integers, all of them sailing past a `Number.isInteger` guard and landing in the one
 * column this whole system compares against a berth. A length recorded as 1000ft is
 * worse than no length at all: the fit check stops saying "cannot verify" and starts
 * saying something false.
 *
 * So the accepted shape is stated rather than inferred: optional sign is not allowed,
 * a decimal point is rejected by name rather than rounded, and digits are digits.
 *
 * Whole feet only, deliberately. Postgres would round 45.5 to 46, and quietly altering
 * a recorded measurement is the wrong failure in a tool whose job is that measurement.
 */

/** Above this a "length in feet" is a typo, not a vessel. The longest ship is ~1,500ft. */
export const MAX_LENGTH_FT = 2000;

export type LengthParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function parseLengthFt(raw: string): LengthParse {
  const t = raw.trim();
  // Blank is a real answer — it means "no length on record", and clearing one back to
  // unknown has to stay possible (invariant 2: never invent a length).
  if (t === '') return { ok: true, value: null };

  if (/^\d+(\.\d+)?$/.test(t) && t.includes('.')) {
    return { ok: false, error: 'Whole feet only.' };
  }
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Enter a length in feet.' };

  const n = Number(t);
  if (n <= 0 || n > MAX_LENGTH_FT) return { ok: false, error: 'Enter a length in feet.' };
  return { ok: true, value: n };
}
