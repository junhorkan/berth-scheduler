/**
 * Look inside an .xlsx before anything inflates it.
 *
 * An .xlsx is a zip, and SheetJS inflates every entry eagerly, sizing its buffers from
 * what the zip *declares*. A reviewer measured a 901KB file — under every upload limit —
 * inflating to 900MB and 1.5GB of memory, then returning zero rows without an error. So
 * the zip's own central directory is read first, by hand, and the file is refused if it
 * declares more than any real schedule could need. Nothing is decompressed here.
 *
 * The real workbook has 36 entries and declares 3.59MB. The limits leave generous room.
 *
 * Pure: bytes in, a summary or an ImportError out. Runs the same in Node and a browser.
 */
import { ImportError } from './errors';

export const ZIP_LIMITS = {
  maxEntries: 500,
  maxDeclaredBytes: 50 * 1024 * 1024,
} as const;

export type ZipSummary = { entries: number; declaredBytes: number; names: string[] };

const CSV_REASON =
  "A CSV can't carry this schedule: a booking's dates are the width of a merged cell, and "
  + 'CSV has no merged cells. Measured on the real workbook, it would drop 58% of booked '
  + 'days and lose the only double-booking in 23 years. Use the .xlsx.';

/** Mostly printable text in the first 512 bytes: a CSV, TSV or other text export. */
function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 512);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  }
  return printable / n > 0.95;
}

export function inspectZip(bytes: Uint8Array): ZipSummary {
  const n = bytes.length;
  if (n === 0) throw new ImportError('That file is empty.');

  const isZip = n >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) {
    throw new ImportError(looksLikeText(bytes) ? CSV_REASON : "That isn't an Excel workbook (.xlsx).");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new ImportError('That workbook is damaged: its zip directory cannot be read.');

  // The end-of-central-directory record sits in the last 22 bytes, or up to 64KB earlier
  // when the zip carries a comment after it.
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw damaged();

  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ImportError('That file uses zip64, which no real workbook of this size needs.');
  }
  if (total > ZIP_LIMITS.maxEntries) {
    throw new ImportError(`That file holds ${total} parts; a workbook has far fewer.`);
  }
  if (cdOffset + cdSize > n) throw damaged();

  const names: string[] = [];
  let declared = 0;
  let p = cdOffset;
  const decoder = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (p + 46 > n || view.getUint32(p, true) !== 0x02014b50) throw damaged();
    const size = view.getUint32(p + 24, true);
    if (size === 0xffffffff) throw new ImportError('That file uses zip64, which no real workbook of this size needs.');
    declared += size;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > n) throw damaged();
    names.push(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (declared > ZIP_LIMITS.maxDeclaredBytes) {
    const mb = (declared / 1024 / 1024).toFixed(0);
    throw new ImportError(`That file would expand to ${mb}MB. A real schedule is a few megabytes.`);
  }
  if (!names.includes('[Content_Types].xml') || !names.includes('xl/workbook.xml')) {
    throw new ImportError("That's a zip file, but not an Excel workbook (.xlsx).");
  }
  return { entries: total, declaredBytes: declared, names };
}
