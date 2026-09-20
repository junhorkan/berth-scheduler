import { test, expect } from '@playwright/test';
import { clearSchedule } from './helpers/schedule';

/**
 * The empty schedule: what a fresh facility sees, and what Clear leaves behind.
 *
 * Named to sort last, because it clears the fixture every other spec depends on.
 */
test.describe('an empty schedule', () => {
  test.beforeAll(async () => {
    await clearSchedule();
  });

  test('is a usable board, not a blank page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.rail')).toHaveCount(7);   // every berth still listed
    await expect(page.locator('.bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ New booking' })).toBeVisible();
  });

  test('offers the sample as an explicit choice rather than preloading it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /load the sample schedule/i })).toBeVisible();
  });

  test('has an empty review queue and no badge', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByText('Nothing needs attention.')).toBeVisible();
    // The badge should be absent entirely, not showing a zero.
    await expect(page.locator('.tabs .count')).toHaveCount(0);
  });

  test('registers a vessel the first time it is booked', async ({ page }) => {
    // Starting empty, every vessel is new. If a booking stored vessel_id = null the
    // Vessels tab would stay empty forever, no length could ever be recorded, and the
    // fit check could never do anything.
    await page.goto('/vessels');
    await expect(page.getByText(/R\/V Test Cutter/)).toHaveCount(0);

    await page.goto('/');
    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByLabel('Vessel', { exact: true }).fill('R/V Test Cutter');
    await page.getByLabel('Berth', { exact: true }).selectOption({ label: 'Inner Channel — 55ft' });

    // A name matching nothing on the register is a new vessel, not an error.
    await expect(page.getByText(/New vessel .* adds it to the register/)).toBeVisible();

    const dates = page.locator('input[type="date"]');
    const start = await dates.first().inputValue();
    const day = Number(start.slice(8, 10));
    const end = `${start.slice(0, 8)}${String(Math.min(day + 3, 28)).padStart(2, '0')}`;
    await dates.nth(1).fill(end);

    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save booking' }).click();

    // By accessible name, not bar text: a short bar suppresses its visible label.
    const created = page.getByLabel(/R\/V Test Cutter/);
    await expect(created).toBeVisible();

    // The registry now knows it, so a length can be recorded and fit-checking begins.
    await page.goto('/vessels');
    await expect(page.getByText('R/V Test Cutter')).toBeVisible();
  });

  test('clears the schedule from Review, leaving only the berths', async ({ page }) => {
    // The one irreversible action in the app. Everything goes but the berths, which
    // are the facility rather than schedule data.
    page.on('dialog', (d) => d.accept());

    await page.goto('/review');
    await page.getByRole('button', { name: /Clear the schedule/ }).click();

    await expect
      .poll(async () => {
        await page.goto('/vessels');
        return page.getByText('R/V Test Cutter').count();
      }, { timeout: 30_000 })
      .toBe(0);

    // Berths are the facility, not schedule data, so they survive a clear.
    await page.goto('/');
    await expect(page.locator('.rail')).toHaveCount(7);
    await expect(page.locator('.bar')).toHaveCount(0);
  });
});
