/**
 * Look inside an .xlsx before SheetJS inflates it.
 *
 * An .xlsx is a zip, and SheetJS inflates every entry eagerly. A reviewer measured a
 * 901KB file — under every upload limit — inflating to 900MB and 1.5GB of memory, then
 * returning zero rows without an error. How much SheetJS allocates, and for how long it
 * loops, is decided by fields in the file, so this reads those fields first, by hand,
 * exactly as SheetJS will (`parse_zip` in xlsx.mjs):
 *
 *  - It finds the end-of-directory record by scanning back from the last four bytes and
 *    taking the first signature it meets. So does this, and it then requires that record
 *    to end exactly at the end of the file, so a second signature hidden in a comment
 *    cannot show this guard one directory and SheetJS another.
 *  - It sizes each entry's output from the entry's *local* header, not the directory. A
 *    stated size of 0 means "unknown" to it, and it then grows its buffer without limit,
 *    so an entry with compressed data and no stated size is refused. The local and
 *    directory sizes must agree.
 *  - A stated size that is a lie still makes SheetJS loop over the whole real output. So
 *    `verifyInflation` decompresses every entry with the platform's own inflater first,
 *    stopping the moment one passes the size it states. That is the only step here that
 *    decompresses anything, and it is bounded by the limits below.
 *
 * The real workbook has 36 entries and states 3.59MB. The limits leave generous room.
 *
 * Pure: bytes in, a summary or an ImportError out. Runs the same in Node and a browser.
 */
import { ImportError } from './errors';

export const ZIP_LIMITS = {
  maxEntries: 500,
  maxDeclaredBytes: 50 * 1024 * 1024,
} as const;

/** One entry, where its compressed bytes are, and the size SheetJS will inflate it to. */
export type ZipEntry = { name: string; method: number; dataStart: number; compressed: number; stated: number };

export type ZipSummary = { entries: number; declaredBytes: number; names: string[]; parts: ZipEntry[] };

const CSV_REASON =
  "A CSV can't carry this schedule: a booking's dates are the width of a merged cell, and "
  + 'CSV has no merged cells. Measured on the real workbook, it would drop 58% of booked '
  + 'days and lose the only double-booking in 23 years. Use the .xlsx.';

const RESAVE = ' Open it in Excel and save it again as .xlsx.';

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

/** Refused before its bytes are read at all, so a huge file never reaches memory. */
export function refuseOversize(size: number): void {
  if (size > ZIP_LIMITS.maxDeclaredBytes) {
    throw new ImportError(
      `That file is ${(size / 1024 / 1024).toFixed(0)}MB. The 23-year sample workbook is 0.4MB, `
      + `so nothing over ${ZIP_LIMITS.maxDeclaredBytes / 1024 / 1024}MB is read.`,
    );
  }
}

/** Whether an extra field carries a zip64 record, which no workbook this size needs. */
function hasZip64(view: DataView, start: number, len: number): boolean {
  for (let q = start; q + 4 <= start + len;) {
    const id = view.getUint16(q, true);
    const size = view.getUint16(q + 2, true);
    if (id === 0x0001) return true;
    q += 4 + size;
  }
  return false;
}

export function inspectZip(bytes: Uint8Array): ZipSummary {
  const n = bytes.length;
  if (n === 0) throw new ImportError('That file is empty.');
  refuseOversize(n);

  const isZip = n >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) {
    throw new ImportError(looksLikeText(bytes) ? CSV_REASON : "That isn't an Excel workbook (.xlsx).");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new ImportError('That workbook is damaged: its zip directory cannot be read.');
  const zip64 = () => new ImportError('That file uses zip64, which no real workbook of this size needs.');

  // The same search SheetJS makes: back from the last four bytes, first signature wins.
  let eocd = -1;
  for (let i = n - 4; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0 || eocd + 22 > n) throw damaged();
  // The record it found must be the one that ends the file, comment and all.
  if (eocd + 22 + view.getUint16(eocd + 20, true) !== n) throw damaged();

  const onDisk = view.getUint16(eocd + 8, true); // the count SheetJS reads
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw zip64();
  if (onDisk !== total) throw damaged();
  if (total > ZIP_LIMITS.maxEntries) {
    throw new ImportError(`That file holds ${total} parts; a workbook has far fewer.`);
  }
  if (cdOffset + cdSize > n) throw damaged();

  const names: string[] = [];
  const parts: ZipEntry[] = [];
  let declared = 0;
  let p = cdOffset;
  const decoder = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (p + 46 > n || view.getUint32(p, true) !== 0x02014b50) throw damaged();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const cdCompressed = view.getUint32(p + 20, true);
    const cdStated = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    if (cdCompressed === 0xffffffff || cdStated === 0xffffffff || local === 0xffffffff) throw zip64();
    if (p + 46 + nameLen + extraLen > n) throw damaged();
    if (hasZip64(view, p + 46 + nameLen, extraLen)) throw zip64();
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The local header is what SheetJS actually reads.
    if (local + 30 > n || view.getUint32(local, true) !== 0x04034b50) throw damaged();
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    if (local + 30 + lNameLen + lExtraLen > n) throw damaged();
    if (hasZip64(view, local + 30 + lNameLen, lExtraLen)) throw zip64();
    const lCompressed = view.getUint32(local + 18, true);
    const lStated = view.getUint32(local + 22, true);
    const dataStart = local + 30 + lNameLen + lExtraLen;
    // With a trailing data descriptor (flag bit 3), the local sizes are left blank.
    const described = (flags & 0x8) !== 0;
    const compressed = described ? cdCompressed : lCompressed;
    if (dataStart + compressed > n) throw damaged();

    if (method === 8) {
      // SheetJS reads a stated size of 0 as "unknown" and grows its buffer to whatever
      // comes out. Nothing honest compresses to more than two bytes and inflates to none.
      if (lStated === 0 && compressed > 2) {
        throw new ImportError(`That workbook doesn't state how big its parts are, so it can't be opened safely.${RESAVE}`);
      }
      if (lStated !== cdStated) throw damaged();
    } else if (method !== 0) {
      throw new ImportError(`That workbook uses a compression Excel doesn't.${RESAVE}`);
    }
    declared += method === 8 ? lStated : compressed;
    names.push(name);
    parts.push({ name, method, dataStart, compressed, stated: method === 8 ? lStated : compressed });
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (declared > ZIP_LIMITS.maxDeclaredBytes) {
    const mb = (declared / 1024 / 1024).toFixed(0);
    throw new ImportError(`That file would expand to ${mb}MB. A real schedule is a few megabytes.`);
  }
  if (!names.includes('[Content_Types].xml') || !names.includes('xl/workbook.xml')) {
    throw new ImportError("That's a zip file, but not an Excel workbook (.xlsx).");
  }
  return { entries: total, declaredBytes: declared, names, parts };
}

/**
 * Inflate every compressed entry with the platform's own decompressor — native, in Node
 * and every current browser — counting what comes out, and refuse the file the moment an
 * entry passes the size it states. A zip bomb works by lying about exactly that.
 *
 * Bounded: no entry is followed past its stated size, and inspectZip has already capped
 * the sum of stated sizes. Async, because the decompressor is a stream.
 */
export async function verifyInflation(bytes: Uint8Array, zip: ZipSummary): Promise<void> {
  for (const part of zip.parts) {
    if (part.method !== 8) continue;
    const out = await inflatedSize(bytes.subarray(part.dataStart, part.dataStart + part.compressed), part.stated);
    if (out > part.stated) {
      throw new ImportError(
        `A part of that file (${part.name}) expands past the size it states, which is how a zip `
        + 'bomb works. It was not opened.',
      );
    }
  }
}

async function inflatedSize(data: Uint8Array, limit: number): Promise<number> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Not awaited: the reader below is what drains it, and a write into a stream that has
  // been cancelled rejects harmlessly.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return total;
      }
    }
  } catch {
    throw new ImportError('That workbook is damaged: one of its parts cannot be decompressed.');
  }
}
