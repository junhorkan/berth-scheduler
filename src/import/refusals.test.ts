import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { planImport, ImportError } from './plan';
import { inspectZip, refuseOversize, verifyInflation, ZIP_LIMITS } from './zipGuard';

/**
 * What the importer refuses, and that it says why. Runs on any clone: every file here is
 * made in memory, so none of it needs the client's workbook.
 *
 * Before this, an empty file, a PDF, random bytes and a CSV all parsed as "success, no
 * bookings" — which an import would have taken as an instruction to empty the schedule.
 */
function xlsx(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  // Compressed, as Excel writes them: the guards below are about compressed entries.
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }));
}

const LOCAL = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const CENTRAL = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);

/** Rewrite the stated size of the first compressed entry, in its local header and the directory. */
function restate(bytes: Uint8Array, size: number): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  let local = 0;
  let cd = indexOf(out, CENTRAL, 0);
  while (view.getUint16(local + 8, true) !== 8) {
    local = indexOf(out, LOCAL, local + 4);
    cd = indexOf(out, CENTRAL, cd + 4);
  }
  view.setUint32(local + 22, size, true);
  view.setUint32(cd + 24, size, true);
  return out;
}

const refusal = async (bytes: Uint8Array) => {
  try { await planImport(bytes); return null; } catch (e) { return e; }
};

describe('the importer refuses, loudly, what is not a schedule', () => {
  it('an empty file', async () => {
    const e = await refusal(new Uint8Array());
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/empty/);
  });

  it('a CSV, and says why a CSV cannot carry this schedule', async () => {
    const csv = new TextEncoder().encode('Berth,1,2,3\nNorth Pier West - 410\',R/V Long Ketch,,\n');
    const e = await refusal(csv);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/merged cell/);
    expect((e as Error).message).toMatch(/58%/);
  });

  it('random bytes', async () => {
    const noise = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);
    expect(await refusal(noise)).toBeInstanceOf(ImportError);
  });

  it('a zip that is not a workbook', async () => {
    // A valid xlsx with its content-types entry renamed is still a zip, but not an xlsx.
    const bytes = xlsx({ '2010': [['x']] });
    const tag = new TextEncoder().encode('[Content_Types].xml');
    const i = indexOf(bytes, tag, indexOf(bytes, CENTRAL, 0));
    const fake = bytes.slice(); fake[i + 1] = 'X'.charCodeAt(0);
    const e = await refusal(fake);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/not an Excel workbook/);
  });

  it('a workbook with no sheet named for a year', async () => {
    const e = await refusal(xlsx({ Notes: [['hello']], Contacts: [['a', 'b']] }));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/no sheet named for a year/);
  });

  it('a year sheet with nothing on it the parser can place', async () => {
    const e = await refusal(xlsx({ '2010': [['just some text']] }));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/hold no bookings/);
  });

  it('a sheet far larger than any schedule, before it is parsed', async () => {
    // A cell at A1 and one 6,000 rows below make the sheet's real extent too large.
    const ws = XLSX.utils.aoa_to_sheet([['a']]);
    XLSX.utils.sheet_add_aoa(ws, [['b']], { origin: 'A6000' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '2010');
    const e = await refusal(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/far past any schedule/);
  });

  it('many sheets that are each allowed but together far larger than any schedule', async () => {
    // Each 1,000 rows by 100 columns is within the per-sheet limit; 21 of them are not.
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < 21; i++) {
      const ws = XLSX.utils.aoa_to_sheet([['a']]);
      XLSX.utils.sheet_add_aoa(ws, [['b']], { origin: { r: 999, c: 99 } });
      XLSX.utils.book_append_sheet(wb, ws, String(2000 + i));
    }
    const e = await refusal(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/span .* cells between them/);
  });
});

describe('inspectZip, before anything is inflated', () => {
  it('reads a real workbook\'s directory', () => {
    const s = inspectZip(xlsx({ '2010': [['x']] }));
    expect(s.names).toContain('xl/workbook.xml');
    expect(s.declaredBytes).toBeGreaterThan(0);
  });

  it('refuses a file that declares it would expand past the limit, without expanding it', () => {
    // SheetJS sizes its buffer from this number, which is what made a 901KB file inflate
    // to 900MB.
    const bytes = restate(xlsx({ '2010': [['x']] }), 60 * 1024 * 1024);
    expect(() => inspectZip(bytes)).toThrow(/would expand to 60MB/);
    expect(60 * 1024 * 1024).toBeGreaterThan(ZIP_LIMITS.maxDeclaredBytes);
  });

  it('refuses a compressed part that states no size, which SheetJS would grow without limit', () => {
    expect(() => inspectZip(restate(xlsx({ '2010': [['x']] }), 0))).toThrow(/doesn't state how big/);
  });

  it('refuses a local header that disagrees with the directory', () => {
    const bytes = xlsx({ '2010': [['x']] });
    const view = new DataView(bytes.buffer);
    let local = 0;
    while (view.getUint16(local + 8, true) !== 8) local = indexOf(bytes, LOCAL, local + 4);
    view.setUint32(local + 22, view.getUint32(local + 22, true) + 1, true);
    expect(() => inspectZip(bytes)).toThrow(/damaged/);
  });

  it('reads the directory record SheetJS reads, not an earlier one', () => {
    // SheetJS scans back from the last four bytes and takes the first signature it meets.
    // A signature planted in the comment's last 22 bytes used to be skipped here and read
    // there, so the two looked at different directories. Now it is found, and refused,
    // because a record 10 bytes from the end cannot be a whole one.
    const bytes = xlsx({ '2010': [['x']] });
    const planted = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0]);
    const out = new Uint8Array(bytes.length + planted.length);
    out.set(bytes); out.set(planted, bytes.length);
    new DataView(out.buffer).setUint16(bytes.length - 2, planted.length, true); // the comment
    expect(() => inspectZip(out)).toThrow(/damaged/);
  });
});

describe('verifyInflation, the only step that decompresses', () => {
  it('passes an honest workbook', async () => {
    const bytes = xlsx({ '2010': [['x']] });
    await expect(verifyInflation(bytes, inspectZip(bytes))).resolves.toBeUndefined();
  });

  it('refuses a part that inflates past the size it states — a zip bomb, in miniature', async () => {
    // SheetJS would loop over the whole real output while writing into a buffer this
    // size; with a real bomb, that is minutes of a frozen tab.
    const bytes = restate(xlsx({ '2010': [['x'.repeat(5000)]] }), 10);
    await expect(verifyInflation(bytes, inspectZip(bytes))).rejects.toThrow(/expands past the size it states/);
    const e = await refusal(bytes);
    expect(e).toBeInstanceOf(ImportError);
  });

  it('refuses a file too big to be a schedule by its size alone, before reading its bytes', () => {
    // /check calls this with File.size, so a huge file never reaches the tab's memory.
    expect(() => refuseOversize(ZIP_LIMITS.maxDeclaredBytes + 1)).toThrow(ImportError);
    expect(() => refuseOversize(394_385)).not.toThrow();
  });
});

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = Math.max(0, from); i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new Error('needle not found');
}
