/**
 * Extracts vessel length data from the workbook's 'Science' and 'Yachts' sheets.
 *
 * These sheets are contact lists, not tables: rows wrap, continuation rows hold only a
 * phone number or an email, and columns are used inconsistently. So rather than assume
 * a column layout we scan every cell for the two patterns that actually carry length:
 *
 *   a name with a trailing length   "R/V High Drift 120'"
 *   an LOA note                     "LOA: 145', Draft: 12'"
 *
 * The two DISAGREE for some vessels (e.g. a name saying 170' beside 'LOA: 65''). Both
 * values are kept and surfaced; reconciling them silently would be inventing data.
 */

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { canonicalVesselName, extractLengthFromVesselName, stripLengthFromVesselName } from '../domain/normalize';

export type RegistryVessel = {
  displayName: string;
  normalizedName: string;
  /** Length embedded in the vessel's name. */
  nameLengthFt: number | null;
  /** Length from a nearby 'LOA: N'' note, when present. */
  loaFt: number | null;
  operator: string | null;
  sourceSheet: string;
  sourceRow: number;
};

const NAME_WITH_LENGTH = /^((?:R\/V|M\/V|S\/V|M\/Y|S\/Y|OSV|OS\/V|F\/V|Tug|Barge)\s+[A-Za-z'’\- ]+?)\s+(\d{2,3})'$/i;
const LOA_NOTE = /\bLOA:\s*(\d{2,3})'/i;
const OPERATOR_HINT = /(University|Institute|Partners|Agency|Trust|Foundation|Academy|Charters|Sailing|Offshore|Fisheries|Research|Marine)/i;

export function parseRegistry(filePath: string): {
  vessels: RegistryVessel[];
  disagreements: RegistryVessel[];
} {
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  const byNormalized = new Map<string, RegistryVessel>();

  for (const sheetName of ['Science', 'Yachts']) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);

    const text = (r: number, c: number) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      return cell && cell.v != null ? String(cell.v).trim() : '';
    };

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = text(r, c);
        if (raw === '') continue;
        const m = raw.match(NAME_WITH_LENGTH);
        if (!m) continue;

        const canon = canonicalVesselName(stripLengthFromVesselName(raw));
        if (byNormalized.has(canon.normalized)) continue;

        // An LOA note and an operator, but only from the SAME row as the vessel name.
        // Scanning continuation rows would attribute a neighbouring vessel's LOA to
        // this one and manufacture a disagreement that is not in the source.
        let loaFt: number | null = null;
        let operator: string | null = null;
        for (let cc = range.s.c; cc <= range.e.c; cc++) {
          if (cc === c) continue;
          const v = text(r, cc);
          if (v === '') continue;
          if (loaFt == null) {
            const loa = v.match(LOA_NOTE);
            if (loa) loaFt = Number(loa[1]);
          }
          if (operator == null && OPERATOR_HINT.test(v) && !/@|Cell:|http/i.test(v)) {
            operator = v;
          }
        }

        byNormalized.set(canon.normalized, {
          displayName: canon.display,
          normalizedName: canon.normalized,
          nameLengthFt: extractLengthFromVesselName(raw),
          loaFt,
          operator,
          sourceSheet: sheetName,
          sourceRow: r + 1,
        });
      }
    }
  }

  const vessels = [...byNormalized.values()];
  const disagreements = vessels.filter(
    (v) => v.nameLengthFt != null && v.loaFt != null && v.nameLengthFt !== v.loaFt,
  );
  return { vessels, disagreements };
}
