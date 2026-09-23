/**
 * Read an .xlsx into a SheetJS workbook, refusing anything that is not one.
 *
 * Every parse goes through here — the command-line importer, the no-database dry run,
 * — so a malformed file is stopped in one place:
 *
 *  - the zip is inspected before it is inflated (zipGuard), reading the same headers
 *    SheetJS will. `planImport` also inflates every entry once, natively and bounded,
 *    before this runs, which is what stops an expansion bomb that lies about its size;
 *  - `WTF: true` makes SheetJS throw instead of swallowing an error inside a sheet, which
 *    it otherwise does silently, handing back an empty sheet as though it were fine;
 *  - `nodim: true` computes each sheet's extent from its real cells instead of trusting
 *    its declared `<dimension>`. A 222KB file declaring A1:XFD1048576 took 92 seconds to
 *    parse before this; the declared size is the attack, the cells are the truth;
 *  - sheet count, each sheet's extent, and their combined extent are capped at many
 *    times the real workbook's (27 sheets, at most 251 rows by 256 columns, 151,167
 *    cells in all).
 *
 * No `node:fs` here, or anywhere the planner reaches: this has to bundle for a browser.
 * `fromFile.ts` is the thin Node-only wrapper that reads a path.
 */
import * as XLSX from 'xlsx';
import { inspectZip } from './zipGuard';
import { ImportError } from './errors';

/**
 * Per sheet, and across all of them. The real workbook spans 151,167 cells over 27
 * sheets; without the total, 64 sparse sheets at the per-sheet limit let a small file buy
 * 320 million cell reads on the browser's main thread.
 */
export const SHEET_LIMITS = { maxSheets: 64, maxRows: 5000, maxCols: 1000, maxTotalCells: 2_000_000 } as const;

export function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  inspectZip(bytes);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', WTF: true, nodim: true });
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    throw new ImportError(`That workbook could not be read: ${why}`);
  }

  if (wb.SheetNames.length > SHEET_LIMITS.maxSheets) {
    throw new ImportError(`That workbook has ${wb.SheetNames.length} sheets; this schedule has 27.`);
  }
  let area = 0;
  for (const name of wb.SheetNames) {
    const ref = wb.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const r = XLSX.utils.decode_range(ref);
    const rows = r.e.r - r.s.r + 1;
    const cols = r.e.c - r.s.c + 1;
    if (rows > SHEET_LIMITS.maxRows || cols > SHEET_LIMITS.maxCols) {
      throw new ImportError(
        `Sheet "${name}" spans ${rows.toLocaleString()} rows by ${cols.toLocaleString()} columns, `
        + 'far past any schedule. Refused rather than parsed.',
      );
    }
    area += rows * cols;
  }
  if (area > SHEET_LIMITS.maxTotalCells) {
    throw new ImportError(
      `That workbook's sheets span ${area.toLocaleString()} cells between them, far past any `
      + 'schedule (the 23-year sample spans about 150,000). Refused rather than parsed.',
    );
  }
  return wb;
}
