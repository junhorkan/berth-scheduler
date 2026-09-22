/**
 * Reads the legacy dock-schedule workbook into flat, structured entries.
 *
 * The workbook is 23 one-year sheets of visual grids, and its layout DRIFTS across
 * those years, so nothing here assumes fixed offsets.
 *
 * THE CRITICAL FACT: which column holds day 1 is NOT constant. There are two grid
 * families in this one file:
 *
 *   1997-2001  columns 1..N map straight onto days 1..N. The weekday letters run the
 *              full width, but only a lone '1' is printed on the day-number row.
 *   2002+      a true CALENDAR layout: day 1 sits under its real weekday, so it
 *              starts at a different column every month (Jan 2010 starts at column E,
 *              Jan 2017 at column C).
 *
 * Assuming any fixed offset silently misaligns every date in the file, and relying on
 * the day-NUMBER row fails for 1997-2001 where it is mostly blank.
 *
 * So the authoritative source is the WEEKDAY STRIP ('S','M','T','W','TR','F'): its
 * populated columns, read left to right, are days 1..N. That single rule decodes both
 * families, and we cross-check it against the day-number row wherever that row is
 * actually filled in.
 *
 * Any row whose column A parses as a berth label is treated as a berth row, so we
 * never depend on berths sitting at a fixed offset either.
 *
 * A booking's date span is encoded as a MERGED CELL RANGE across day columns. The
 * merge IS the span; that is the single most important fact about this file.
 */

import * as XLSX from 'xlsx';
import { classifyEntry, parseBerthLabel, type EntryKind } from '../domain/normalize';
import { readWorkbook } from './workbook';

/** One populated cell inside a berth row, before any stitching. */
export type RawEntry = {
  year: number;
  /** 1-12 */
  month: number;
  /** Berth label exactly as written, e.g. "South Float East - 90'". */
  berthLabel: string;
  berthName: string;
  berthLengthFt: number | null;
  /** 1-based day of month, inclusive on both ends. */
  startDay: number;
  endDay: number;
  text: string;
  kind: EntryKind;
  /** Provenance back to the exact spreadsheet cell (1-based, as a human sees it). */
  sheet: string;
  row: number;
  col: number;
};

export type ParseReport = {
  sheetsScanned: string[];
  /**
   * Every sheet that was NOT read as a year grid, and why. These used to be skipped with
   * no trace, so a workbook whose grids were all misnamed parsed as "success, nothing
   * booked". Now each one is named, and a workbook with no grids at all is an error.
   */
  sheetsSkipped: { sheet: string; reason: string }[];
  monthBlocks: number;
  /** Blocks where no day alignment could be found — reported, never ignored. */
  blocksWithoutDayStrip: string[];
  /** Blocks whose weekday letters did not match the real calendar. */
  blocksWithUnverifiedCalendar: string[];
  /**
   * Legitimate carry-over blocks: the previous December repeated at the top of the
   * next year's sheet. Their bookings merge with the original rather than duplicating.
   */
  carryOverBlocks: { sheet: string; month: number; year: number }[];
  /**
   * Headers stating a year that cannot be right, where the sheet name was trusted
   * instead. These are source typos and are surfaced for review.
   */
  headerYearAnomalies: {
    sheet: string; row: number; month: number; statedYear: number; usedYear: number;
  }[];
  rawCells: number;
  byKind: Record<EntryKind, number>;
  /** Cells in a berth row but outside the day columns (margin notes). */
  marginCells: number;
  /**
   * Text cells sitting on grid-furniture rows (month header / day / weekday strips),
   * which therefore belong to no berth and cannot be attributed. Counted, never
   * silently dropped — 2010/11 and 2010/12 have vessel names typed into the
   * day-number row.
   */
  orphanedGridCells: { sheet: string; row: number; col: number; text: string }[];
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** 'AUGUST 1997' -> 8, 'January' -> 1, anything else -> null. */
export function monthFromHeader(raw: string): number | null {
  return headerMonthYear(raw)?.month ?? null;
}

/**
 * Read both month and, when stated, the YEAR from a block header.
 *
 * This matters more than it looks: the 2002, 2003 and 2004 sheets each OPEN with the
 * previous December carried over for context ('DECEMBER 2001' sits at the top of the
 * 2002 sheet). Taking the year from the sheet name would date those blocks a year late
 * and silently corrupt every booking in them, so the header text wins whenever it
 * carries a year. Bare headers like 'January' (2017+) fall back to the sheet name.
 */
export function headerMonthYear(raw: string): { month: number; year: number | null } | null {
  const t = raw.trim().toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    if (t === MONTHS[i]) return { month: i + 1, year: null };
    if (t.startsWith(MONTHS[i] + ' ')) {
      const m = t.match(/\b(19|20)\d{2}\b/);
      return { month: i + 1, year: m ? Number(m[0]) : null };
    }
  }
  return null;
}

function cellText(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v == null) return '';
  return String(cell.v).trim();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Single-letter weekday codes used across all 23 years. */
const WEEKDAY = /^(S|M|T|W|TR|F)$/;

/** Weekday letter the file uses for a given JS day index (0 = Sunday). */
const WEEKDAY_FOR_DOW = ['S', 'M', 'T', 'W', 'TR', 'F', 'S'];

export type DayColumns = {
  /** column index of day 1; day d lives at (dayOneCol + d - 1) */
  dayOneCol: number;
  colToDay: Map<number, number>;
  /** rows that carry grid furniture rather than bookings */
  gridRows: Set<number>;
  /** how many independent anchors agreed on this alignment */
  support: number;
  /** true when the weekday letters match the real calendar for this month */
  calendarVerified: boolean;
};

/**
 * Work out which column holds which day of the month.
 *
 * Day columns are always CONTIGUOUS, so a single confirmed (column, day) pair fixes
 * the whole strip. We therefore gather every anchor we can find and take the most
 * commonly implied offset, which survives all three defects present in this file:
 *
 *   - 1997-2001 print only a lone '1' on the day-number row
 *   - 2008/6, 2009/2, 2011/9 have weekday strips whose length or spacing is wrong
 *   - 2010/11, 2010/12 have vessel names typed OVER the first few day numbers
 *
 * Finally we check the weekday letters against the real calendar for that month, which
 * is a genuinely independent confirmation that the alignment is right.
 */
export function findDayColumns(
  sheet: XLSX.WorkSheet,
  headerRow: number,
  searchLimit: number,
  year: number,
  month: number,
  lastDay: number,
  lastCol: number,
): DayColumns | null {
  // offset -> number of anchors implying it, where offset = col - day
  const votes = new Map<number, number>();
  const gridRows = new Set<number>();

  const vote = (offset: number, weight = 1) => {
    if (offset < 0) return;
    votes.set(offset, (votes.get(offset) ?? 0) + weight);
  };

  for (let r = headerRow; r <= searchLimit; r++) {
    let numericAnchors = 0;
    let weekdayCells = 0;
    const weekdayCols: number[] = [];

    for (let c = 1; c <= lastCol; c++) {
      const t = cellText(sheet, r, c);
      if (t === '') continue;
      if (WEEKDAY.test(t)) {
        weekdayCells++;
        weekdayCols.push(c);
        continue;
      }
      if (/^\d{1,2}$/.test(t)) {
        const day = Number(t);
        if (day >= 1 && day <= lastDay) {
          vote(c - day);
          numericAnchors++;
        }
      }
    }

    if (numericAnchors >= 2) gridRows.add(r);
    if (weekdayCells >= Math.floor(lastDay / 2)) {
      gridRows.add(r);
      // A contiguous strip of the right length points straight at day 1.
      if (weekdayCols.length > 0) vote(weekdayCols[0] - 1, 2);
    }
  }

  if (votes.size === 0) return null;

  let bestOffset = -1;
  let bestSupport = 0;
  for (const [offset, support] of votes) {
    if (support > bestSupport) {
      bestSupport = support;
      bestOffset = offset;
    }
  }
  // A single stray numeral is not evidence of an alignment.
  if (bestSupport < 2) return null;

  const dayOneCol = bestOffset + 1;
  const colToDay = new Map<number, number>();
  for (let d = 1; d <= lastDay; d++) colToDay.set(dayOneCol + d - 1, d);

  // Independent check: does the weekday letter above day 1 match the real calendar?
  const expected = WEEKDAY_FOR_DOW[new Date(Date.UTC(year, month - 1, 1)).getUTCDay()];
  let calendarVerified = false;
  for (const r of gridRows) {
    const t = cellText(sheet, r, dayOneCol);
    if (WEEKDAY.test(t)) {
      calendarVerified = t === expected;
      break;
    }
  }

  return { dayOneCol, colToDay, gridRows, support: bestSupport, calendarVerified };
}

/** Read the workbook from disk. Kept separate so the parser itself stays testable. */
/** Parse an .xlsx's bytes. Reading a path lives in `fromFile.ts`, which is Node-only. */
export function parseWorkbookBuffer(bytes: Uint8Array): { entries: RawEntry[]; report: ParseReport } {
  return parseGrids(readWorkbook(bytes));
}

/**
 * Parse the year grids of a workbook that has already been read, so a caller that also
 * wants the registry reads the file once rather than twice.
 */
export function parseGrids(wb: XLSX.WorkBook): { entries: RawEntry[]; report: ParseReport } {
  const entries: RawEntry[] = [];
  const report: ParseReport = {
    sheetsScanned: [],
    sheetsSkipped: [],
    monthBlocks: 0,
    blocksWithoutDayStrip: [],
    blocksWithUnverifiedCalendar: [],
    carryOverBlocks: [],
    headerYearAnomalies: [],
    rawCells: 0,
    byKind: { vessel: 0, event: 0, closure: 0, annotation: 0, unclassified: 0 },
    marginCells: 0,
    orphanedGridCells: [],
  };

  for (const sheetName of wb.SheetNames) {
    // Only the year grids. '8YR Dock Summary', 'Science', 'Yachts' and 'Tours' are
    // different shapes and handled elsewhere (or out of scope).
    if (!/^\d{4}$/.test(sheetName)) {
      report.sheetsSkipped.push({ sheet: sheetName, reason: 'not named for a year' });
      continue;
    }
    const sheetYear = Number(sheetName);
    // A four-digit name is not enough: '0001' matches the pattern and would produce an
    // unpadded ISO year. Only years a schedule could plausibly hold are read.
    if (sheetYear < 1900 || sheetYear > 2200) {
      report.sheetsSkipped.push({ sheet: sheetName, reason: 'named for an implausible year' });
      continue;
    }
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
      report.sheetsSkipped.push({ sheet: sheetName, reason: 'empty' });
      continue;
    }
    report.sheetsScanned.push(sheetName);

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lastRow = range.e.r;
    const lastCol = range.e.c;

    // Merged ranges indexed by top-left cell, so a cell can look up its own span.
    const mergeEndByStart = new Map<string, number>();
    for (const m of sheet['!merges'] ?? []) {
      mergeEndByStart.set(`${m.s.r}:${m.s.c}`, m.e.c);
    }

    // Every month header in column A. A header may declare its own year, but a stated
    // year is only trusted when it is credible:
    //
    //   same year as the sheet            -> normal
    //   previous December                 -> a genuine carry-over block; the 2002, 2003
    //                                        and 2004 sheets each open with one
    //   anything else                     -> a typo. The 2010 sheet says 'NOVEMBER 2018'
    //                                        and 'DECEMBER 2018', but the 2018 sheet
    //                                        already owns those months, so 2010 wins.
    //
    // Trusting a stated year blindly would move two blocks of 2010 bookings eight years
    // into the future; ignoring stated years entirely would misdate the carry-overs.
    const headers: { row: number; month: number; year: number }[] = [];
    for (let r = range.s.r; r <= lastRow; r++) {
      const parsed = headerMonthYear(cellText(sheet, r, 0));
      if (!parsed) continue;

      let year = sheetYear;
      if (parsed.year != null && parsed.year !== sheetYear) {
        const isCarryOver = parsed.month === 12 && parsed.year === sheetYear - 1;
        if (isCarryOver) {
          year = parsed.year;
        } else {
          report.headerYearAnomalies.push({
            sheet: sheetName,
            row: r + 1,
            statedYear: parsed.year,
            usedYear: sheetYear,
            month: parsed.month,
          });
        }
      }
      headers.push({ row: r, month: parsed.month, year });
    }

    for (let h = 0; h < headers.length; h++) {
      const { row: headerRow, month, year } = headers[h];
      const blockEnd = h + 1 < headers.length ? headers[h + 1].row - 1 : lastRow;
      report.monthBlocks++;
      if (year !== sheetYear) report.carryOverBlocks.push({ sheet: sheetName, month, year });

      const lastDay = daysInMonth(year, month);
      const found = findDayColumns(
        sheet,
        headerRow,
        Math.min(headerRow + 3, blockEnd),
        year,
        month,
        lastDay,
        lastCol,
      );

      if (!found) {
        // Do not guess an alignment: a wrong offset would silently shift dates.
        report.blocksWithoutDayStrip.push(`${sheetName}/${month}`);
        continue;
      }
      const { colToDay, gridRows, calendarVerified } = found;
      const maxDayCol = Math.max(...colToDay.keys());
      if (!calendarVerified) report.blocksWithUnverifiedCalendar.push(`${sheetName}/${month}`);

      for (let r = headerRow; r <= blockEnd; r++) {
        if (r === headerRow || gridRows.has(r)) {
          // Capture anything on a furniture row that looks like a booking, so it can
          // surface for human review instead of disappearing.
          for (let c = 1; c <= lastCol; c++) {
            const t = cellText(sheet, r, c);
            if (t === '' || WEEKDAY.test(t) || /^\d{1,2}$/.test(t)) continue;
            report.orphanedGridCells.push({ sheet: sheetName, row: r + 1, col: c + 1, text: t });
          }
          continue;
        }

        const label = cellText(sheet, r, 0);
        if (label === '') continue;
        // Guard against a month name being read as a berth.
        if (monthFromHeader(label)) continue;

        // Returns null for 'North Finger Piers:' — a section header, not a berth.
        const berth = parseBerthLabel(label);
        if (!berth) continue;

        for (let c = 1; c <= lastCol; c++) {
          const text = cellText(sheet, r, c);
          if (text === '') continue;

          const startDay = colToDay.get(c);
          if (startDay == null) {
            // Outside the day strip: a margin note, not a booking.
            report.marginCells++;
            continue;
          }

          const mergeEndCol = mergeEndByStart.get(`${r}:${c}`);
          const endDay =
            mergeEndCol != null
              ? (colToDay.get(Math.min(mergeEndCol, maxDayCol)) ?? startDay)
              : startDay;

          const kind = classifyEntry(text);
          report.rawCells++;
          report.byKind[kind]++;

          entries.push({
            year,
            month,
            berthLabel: label,
            berthName: berth.name,
            berthLengthFt: berth.lengthFt,
            startDay,
            endDay: Math.max(startDay, endDay),
            text,
            kind,
            sheet: sheetName,
            row: r + 1,
            col: c + 1,
          });
        }
      }
    }
  }

  return { entries, report };
}
