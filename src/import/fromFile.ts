/**
 * Reading a workbook from a path. Node only.
 *
 * Everything else in `src/import` works on bytes so it can run in a browser; this is the
 * one file that touches `node:fs`, and nothing a browser loads may import it. The
 * command-line scripts and the tests use it.
 */
import { readFileSync } from 'node:fs';
import { parseWorkbookBuffer } from './parseWorkbook';
import { parseRegistryBuffer } from './parseRegistry';

export const readBytes = (path: string): Uint8Array => readFileSync(path);
export const parseWorkbook = (path: string) => parseWorkbookBuffer(readBytes(path));
export const parseRegistry = (path: string) => parseRegistryBuffer(readBytes(path));
