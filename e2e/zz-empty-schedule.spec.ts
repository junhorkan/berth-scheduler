import { test, expect } from '@playwright/test';
import { clearSchedule } from './helpers/schedule';

/**
 * How the app actually ships: an empty schedule with the berths in place.
 *
 * Named to sort last, because it clears the sample every other spec depends on.
 */
test.describe('an empty schedule', () => {
  test.beforeAll(async () => {
    await clearSchedule();
  });

  test('is a usable board, not a blank page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.rail')).toHaveCount(7);   // every berth still listed
    await expect(page.locator('.bar')).toHaveCount(0);
    await expect(page.getByText(/Every berth below is free/)).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New booking' })).toBeVisible();
  });

  test('offers the sample as an explicit choice rather than preloading it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Load the sample schedule/ })).toBeVisible();
  });

  test('has an empty review queue, with no missing-length noise', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByText('Nothing needs attention.')).toBeVisible();
    // The Review badge should be absent entirely, not showing a zero.
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

    await page.goto('/');
    page.on('dialog', (d) => d.accept());
    await created.click();
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByLabel(/R\/V Test Cutter/)).toHaveCount(0);
  });
});

test.describe('loading and clearing the sample through the UI', () => {
  test.beforeAll(async () => {
    await clearSchedule();
  });
  test.afterAll(async () => {
    await clearSchedule();
  });

  test('loads the sample from the board, then clears it from Review', async ({ page }) => {
    // The buttons are the whole feature. Exercising the SQL directly, as the rest of
    // the suite does, would not catch a broken server action or a wired-up-wrong button.
    page.on('dialog', (d) => d.accept());

    await page.goto('/');
    await expect(page.locator('.bar')).toHaveCount(0);
    await page.getByRole('button', { name: /Load the sample schedule/ }).click();

    // July 2010 is the sample's busiest month; bars there prove the load landed.
    await expect
      .poll(async () => {
        await page.goto('/?y=2010&m=7');
        return page.locator('.bar').count();
      }, { timeout: 30_000 })
      .toBeGreaterThan(0);

    // The queue now holds the items that need a decision, and no missing-length noise.
    await page.goto('/review');
    await expect(page.getByText('Unresolved conflict').first()).toBeVisible();

    await page.getByRole('button', { name: /Clear the schedule/ }).click();
    await expect
      .poll(async () => {
        await page.goto('/?y=2010&m=7');
        return page.locator('.bar').count();
      }, { timeout: 30_000 })
      .toBe(0);

    // Berths are the facility, not sample data, so they survive a clear.
    await expect(page.locator('.rail')).toHaveCount(7);
  });
});
