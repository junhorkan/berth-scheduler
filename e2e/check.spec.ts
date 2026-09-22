import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

/**
 * /check reads a workbook in the browser and saves nothing.
 *
 * The workbook is the club's material and is gitignored, so the specs that need it skip
 * on a fresh clone; the refusal spec builds its own file and always runs. None of these
 * write to the database — there is no server path behind the page to write through.
 */
const WORKBOOK = 'data/Dock Schedule - Synthetic Sample.xlsx';
const haveWorkbook = existsSync(WORKBOOK);

test.describe('checking a workbook', () => {
  test('reads the real workbook in the browser, matching the sample, and sends nothing', async ({ page }) => {
    test.skip(!haveWorkbook, 'the workbook is gitignored');
    await page.goto('/check');

    // Nothing leaves the browser: no request that could carry the file.
    const sent: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`); });

    await page.setInputFiles('input[type=file]', WORKBOOK);
    const result = page.locator('.checkresult');
    await expect(result).toContainText('2,031 stays');
    await expect(result).toContainText('Matches the sample imported here, booking for booking');
    await expect(result.locator('.qsection').first()).toContainText('Utility work on pier face');
    expect(sent).toEqual([]);
  });

  test('catches a double-booking planted in an edited copy', async ({ page }) => {
    test.skip(!haveWorkbook, 'the workbook is gitignored');

    // The workbook's one double-booking is a second South Float East row in July 2017
    // (row 88). Plant another on it, on 13 July, inside OSV AMBER REEF's 9–18 July stay.
    const wb = XLSX.read(readFileSync(WORKBOOK), { type: 'buffer' });
    const ws = wb.Sheets['2017'];
    expect(String(ws['A88'].v)).toContain('South Float East');
    expect(ws['O88']).toBeUndefined();
    ws['O88'] = { t: 's', v: 'R/V Planted Test' };
    const edited = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;

    await page.goto('/check');
    await page.setInputFiles('input[type=file]', {
      name: 'edited.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: edited,
    });
    const result = page.locator('.checkresult');
    await expect(result).toContainText('Differs from the sample imported here');
    await expect(result).toContainText('double-bookings: 2 in this file, 1 in the sample');
    await expect(result).toContainText('Bookings differ in Jul 2017');
    const conflicts = result.locator('.qsection').first();
    await expect(conflicts).toContainText('R/V Planted Test');
    await expect(conflicts).toContainText(/overlaps OSV AMBER REEF/i);
  });

  test('sees two bookings swap dates, which leaves every total the same', async ({ page }) => {
    test.skip(!haveWorkbook, 'the workbook is gitignored');
    // The edit that made the first version of this page call a different schedule
    // identical: it compared four totals, and a swap changes none of them.
    const wb = XLSX.read(readFileSync(WORKBOOK), { type: 'buffer' });
    const ws = wb.Sheets['2015'];
    const [a, b] = [ws['U34'], ws['Y34']];
    expect(a && b).toBeTruthy();
    ws['U34'] = b; ws['Y34'] = a;

    await page.goto('/check');
    await page.setInputFiles('input[type=file]', {
      name: 'swapped.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer,
    });
    const result = page.locator('.checkresult');
    await expect(result).toContainText('Differs from the sample imported here');
    await expect(result).toContainText('Bookings differ in Mar 2015');
    await expect(result).not.toContainText('in this file');
  });

  test('refuses a CSV, and says why', async ({ page }) => {
    await page.goto('/check');
    await page.setInputFiles('input[type=file]', {
      name: 'schedule.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Berth,Day,Vessel\nInner Channel,1,R/V Long Ketch\n'),
    });
    const result = page.locator('.checkresult');
    await expect(result).toContainText('Would not be imported');
    await expect(result).toContainText('merged cell');
  });
});

/**
 * /check is a destination, not a tab, and the foot of Review is the only way in. A copy
 * edit there once removed the paragraph the link lived inside; this is the spec that
 * notices if the next one removes the link with it.
 */
test('Review is the way in to /check, under the sample controls', async ({ page }) => {
  await page.goto('/review');
  const foot = page.locator('.sampledata');
  await expect(foot).toContainText('Both can be put back afterwards.');
  await foot.getByRole('link', { name: /Check a workbook/ }).click();
  await expect(page).toHaveURL(/\/check$/);
  await expect(page.locator('h1')).toContainText('Check a workbook');
});
