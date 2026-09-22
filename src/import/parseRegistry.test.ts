import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseRegistry } from './fromFile';

/**
 * The vessel registry — the Science and Yachts sheets — is where every known length in
 * the file comes from, and it contradicts itself. Reads the client's workbook, which is
 * not in the repository; without it this block is skipped by name. See the note in
 * parseWorkbook.test.ts.
 */
const WORKBOOK = 'data/Dock Schedule - Synthetic Sample.xlsx';
const HAS_WORKBOOK = existsSync(WORKBOOK);

describe.skipIf(!HAS_WORKBOOK)(`parseRegistry against the real workbook (needs ${WORKBOOK})`, () => {
  const { vessels, disagreements } = HAS_WORKBOOK
    ? parseRegistry(WORKBOOK)
    : { vessels: [], disagreements: [] };

  it('reads both registry sheets', () => {
    expect(vessels).toHaveLength(164);
    expect(new Set(vessels.map((v) => v.sourceSheet))).toEqual(new Set(['Science', 'Yachts']));
  });

  it('keeps both answers when the registry contradicts itself, and chooses neither', () => {
    // Each of these states one length in its name and a different LOA in its notes.
    // Picking one would be inventing a measurement; both are stored and the conflict is
    // reported instead. ASSUMPTIONS.md → Reading the workbook.
    expect(disagreements.map((d) => [d.displayName, d.nameLengthFt, d.loaFt])).toEqual([
      ['R/V High Sound', 32, 65],
      ['Barge NORTHERN MARLIN', 24, 65],
      ['M/Y Western Strand', 52, 65],
    ]);
  });

  it('says where each contradiction is, so a person can go and look', () => {
    for (const d of disagreements) {
      expect(['Science', 'Yachts']).toContain(d.sourceSheet);
      expect(d.sourceRow).toBeGreaterThan(0);
    }
  });
});
