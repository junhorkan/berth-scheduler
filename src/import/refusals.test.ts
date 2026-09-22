import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { planImport, ImportError } from './plan';
import { inspectZip, ZIP_LIMITS } from './zipGuard';

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
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

const refusal = (bytes: Uint8Array) => {
  try { planImport(bytes); return null; } catch (e) { return e; }
};

describe('the importer refuses, loudly, what is not a schedule', () => {
  it('an empty file', () => {
    const e = refusal(new Uint8Array());
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/empty/);
  });

  it('a CSV, and says why a CSV cannot carry this schedule', () => {
    const csv = new TextEncoder().encode('Berth,1,2,3\nNorth Pier West - 410\',R/V Long Ketch,,\n');
    const e = refusal(csv);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/merged cell/);
    expect((e as Error).message).toMatch(/58%/);
  });

  it('random bytes', () => {
    const noise = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);
    expect(refusal(noise)).toBeInstanceOf(ImportError);
  });

  it('a zip that is not a workbook', () => {
    // A valid xlsx with its content-types entry renamed is still a zip, but not an xlsx.
    const bytes = xlsx({ '2010': [['x']] });
    const tag = new TextEncoder().encode('[Content_Types].xml');
    const i = indexOf(bytes, tag, bytes.length - 2000);
    const fake = bytes.slice(); fake[i + 1] = 'X'.charCodeAt(0);
    const e = refusal(fake);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/not an Excel workbook/);
  });

  it('a workbook with no sheet named for a year', () => {
    const e = refusal(xlsx({ Notes: [['hello']], Contacts: [['a', 'b']] }));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/no sheet named for a year/);
  });

  it('a year sheet with nothing on it the parser can place', () => {
    const e = refusal(xlsx({ '2010': [['just some text']] }));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/hold no bookings/);
  });

  it('a sheet far larger than any schedule, before it is parsed', () => {
    // A cell at A1 and one 6,000 rows below make the sheet's real extent too large.
    const ws = XLSX.utils.aoa_to_sheet([['a']]);
    XLSX.utils.sheet_add_aoa(ws, [['b']], { origin: 'A6000' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '2010');
    const e = refusal(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toMatch(/far past any schedule/);
  });
});

describe('inspectZip, before anything is inflated', () => {
  it('reads a real workbook\'s directory', () => {
    const s = inspectZip(xlsx({ '2010': [['x']] }));
    expect(s.names).toContain('xl/workbook.xml');
    expect(s.declaredBytes).toBeGreaterThan(0);
  });

  it('refuses a file that declares it would expand past the limit, without expanding it', () => {
    // Rewrite one entry's declared size in the central directory to 60MB. SheetJS sizes
    // its buffers from this number, which is what made a 901KB file inflate to 900MB.
    const bytes = xlsx({ '2010': [['x']] }).slice();
    const view = new DataView(bytes.buffer);
    const cd = indexOf(bytes, new Uint8Array([0x50, 0x4b, 0x01, 0x02]), 0);
    view.setUint32(cd + 24, 60 * 1024 * 1024, true);
    expect(() => inspectZip(bytes)).toThrow(/would expand to 60MB/);
    expect(60 * 1024 * 1024).toBeGreaterThan(ZIP_LIMITS.maxDeclaredBytes);
  });
});

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = Math.max(0, from); i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new Error('needle not found');
}
