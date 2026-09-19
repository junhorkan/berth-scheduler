import { test, expect } from '@playwright/test';
import { REGULAR_BOOKING_COUNT } from './helpers/schedule';

/**
 * Search exists because the board shows one month and the schedule spans many.
 * These assert the path a coordinator actually takes: name in the box, booking on screen.
 */

test.describe('finding a booking', () => {
  test('finds a vessel from the masthead and jumps to it on the board', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: /find a vessel or event/i }).fill('test harbor');
    await page.getByRole('button', { name: 'Find' }).click();

    await expect(page.locator('.shead b', { hasText: 'R/V Test Harbor' })).toBeVisible();

    // A result you cannot reach is not a result.
    await page.locator('.sjump').first().click();
    await expect(page).toHaveURL(/\?y=\d{4}&m=\d{1,2}&sel=/);
    await expect(page.locator('.bar')).not.toHaveCount(0);
  });

  test('finds a non-vessel event, which the brief calls out explicitly', async ({ page }) => {
    await page.goto('/search?q=sail');
    await expect(page.locator('.shead b', { hasText: 'Community sail day' })).toBeVisible();
    // The kind is named in text, not by colour alone.
    await expect(page.locator('.skind.event').first()).toHaveText('event');
  });

  test('finds a berth closure', async ({ page }) => {
    await page.goto('/search?q=maintenance');
    await expect(page.locator('.sgroup').first()).toContainText(/maintenance/i);
    await expect(page.locator('.skind').first()).toHaveText('closure');
  });

  test('folds the OS/V spelling into OSV, so the typo variant still finds the hull', async ({ page }) => {
    await page.goto('/search?q=OS%2FV');
    await expect(page.locator('.shead b', { hasText: 'OSV Test Osprey' })).toBeVisible();
  });

  test('collapses a busy vessel and expands it on request', async ({ page }) => {
    await page.goto('/search?q=test+regular');
    // A vessel with many bookings must not render as many rows by default.
    await expect(page.locator('.smonth')).toHaveCount(6);

    await page.locator('.smore').first().click();
    await expect(page.locator('.smonth')).toHaveCount(REGULAR_BOOKING_COUNT);
    await expect(page.getByText('Show fewer')).toBeVisible();
  });

  test('treats a typed % as text, not as a LIKE wildcard', async ({ page }) => {
    // Unescaped, this pattern matches every booking in the schedule.
    await page.goto('/search?q=100%25');
    await expect(page.getByText(/Nothing on the schedule matches/)).toBeVisible();
    await expect(page.locator('.sgroup')).toHaveCount(0);
  });

  test('asks for more input rather than showing an error on a short query', async ({ page }) => {
    await page.goto('/search?q=a');
    await expect(page.getByText(/Find anything that occupies a berth/)).toBeVisible();
    await expect(page.getByText(/Nothing on the schedule matches/)).toHaveCount(0);
  });

  test('says so plainly when nothing matches', async ({ page }) => {
    await page.goto('/search?q=zzzznothing');
    await expect(page.getByText(/Nothing on the schedule matches/)).toBeVisible();
  });

  test('keeps the query in the box so it can be refined', async ({ page }) => {
    await page.goto('/search?q=test+harbor');
    await expect(page.getByRole('searchbox', { name: /find a vessel or event/i }))
      .toHaveValue('test harbor');
  });

  test('every result row has a complete accessible jump label', async ({ page }) => {
    await page.goto('/search?q=sail');
    const jumps = page.locator('.sjump');
    const count = await jumps.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const label = await jumps.nth(i).getAttribute('aria-label');
      expect(label, `row ${i} jump label`).toMatch(/^Show .+ on the board, .+/);
    }
  });

  test('the search box is reachable from every tab', async ({ page }) => {
    for (const path of ['/', '/vessels', '/review']) {
      await page.goto(path);
      await expect(
        page.getByRole('searchbox', { name: /find a vessel or event/i }),
        `search box on ${path}`,
      ).toBeVisible();
    }
  });
});
