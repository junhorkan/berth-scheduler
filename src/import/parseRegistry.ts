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

import * as XLSX from 'xlsx';
import { canonicalVesselName, extractLengthFromVesselName, stripLengthFromVesselName } from '../domain/normalize';
import { readWorkbook } from './workbook';

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

/**
 * A vessel name ending in its length: "R/V High Drift 120'".
 *
 * The name is WORDS separated by whitespace, and a word cannot contain whitespace. The
 * previous pattern let a lazy name class and the separator after it both match spaces,
 * so a cell of "R/V " plus 5,000 spaces took 21 seconds to fail — the engine tried every
 * way of dividing the spaces between them. With the two made disjoint there is one way
 * to match, and the time is linear. Same matches on the real workbook: 164 vessels.
 */
const NAME_WITH_LENGTH = /^((?:R\/V|M\/V|S\/V|M\/Y|S\/Y|OSV|OS\/V|F\/V|Tug|Barge)\s+[A-Za-z'’\-]+(?:\s+[A-Za-z'’\-]+)*)\s+(\d{2,3})'$/i;
/** No registry cell is longer than 78 characters; anything past this is not a name. */
const MAX_CELL = 300;
const LOA_NOTE = /\bLOA:\s*(\d{2,3})'/i;
const OPERATOR_HINT = /(University|Institute|Partners|Agency|Trust|Foundation|Academy|Charters|Sailing|Offshore|Fisheries|Research|Marine)/i;

export type RegistryResult = {
  vessels: RegistryVessel[];
  disagreements: RegistryVessel[];
  /** Which registry sheets were present and read — a missing one is no longer silent. */
  sheetsRead: string[];
};

export const REGISTRY_SHEETS = ['Science', 'Yachts'] as const;

/** Parse an .xlsx's bytes. Reading a path lives in `fromFile.ts`, which is Node-only. */
export function parseRegistryBuffer(bytes: Uint8Array): RegistryResult {
  return parseRegistryBook(readWorkbook(bytes));
}

export function parseRegistryBook(wb: XLSX.WorkBook): RegistryResult {
  const byNormalized = new Map<string, RegistryVessel>();
  const sheetsRead: string[] = [];

  for (const sheetName of REGISTRY_SHEETS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;
    sheetsRead.push(sheetName);
    const range = XLSX.utils.decode_range(sheet['!ref']);

    const text = (r: number, c: number) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      return cell && cell.v != null ? String(cell.v).trim() : '';
    };

    /**
     * A row's LOA notes and operator-looking cells, read once. It used to be re-read for
     * every vessel name in the row, which a row of a thousand names turns into a million
     * regex tests on the browser's main thread.
     */
    const scanRow = (r: number) => {
      const loa: { c: number; ft: number }[] = [];
      const op: { c: number; v: string }[] = [];
      for (let cc = range.s.c; cc <= range.e.c; cc++) {
        const v = text(r, cc);
        if (v === '') continue;
        const m = v.match(LOA_NOTE);
        if (m) loa.push({ c: cc, ft: Number(m[1]) });
        if (OPERATOR_HINT.test(v) && !/@|Cell:|http/i.test(v)) op.push({ c: cc, v });
      }
      return { loa, op };
    };

    for (let r = range.s.r; r <= range.e.r; r++) {
      let row: ReturnType<typeof scanRow> | null = null;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = text(r, c);
        if (raw === '' || raw.length > MAX_CELL) continue;
        const m = raw.match(NAME_WITH_LENGTH);
        if (!m) continue;

        const canon = canonicalVesselName(stripLengthFromVesselName(raw));
        if (byNormalized.has(canon.normalized)) continue;

        // An LOA note and an operator, but only from the SAME row as the vessel name.
        // Scanning continuation rows would attribute a neighbouring vessel's LOA to
        // this one and manufacture a disagreement that is not in the source.
        row ??= scanRow(r);
        // The first of each in the row, other than the name's own cell.
        const loaFt = row.loa.find((x) => x.c !== c)?.ft ?? null;
        const operator = row.op.find((x) => x.c !== c)?.v ?? null;

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
  return { vessels, disagreements, sheetsRead };
}
