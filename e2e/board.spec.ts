import { test, expect } from '@playwright/test';

/**
 * The board is the product. These assert the two things it exists to do:
 * make a misfit visible, and make a conflict impossible to commit.
 */

const JULY_2010 = '/?y=2010&m=7';

test.describe('the board', () => {
  test('opens on July 2010 so all four bar states are visible on arrival', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('July 2010')).toBeVisible();
    // The landing month must never be empty — that reads as a broken app.
    await expect(page.locator('.bar')).not.toHaveCount(0);
  });

  test('draws a vessel that does not fit taller than its lane', async ({ page }) => {
    await page.goto(JULY_2010);
    const tooLong = page.locator('.bar.toolong').first();
    await expect(tooLong).toBeVisible();

    // R/V CLEAR TERN is 120ft in the 75ft North Pier Face: 120/75 = 1.6 lanes.
    const height = await tooLong.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(40); // lane track is 30px
    await expect(tooLong).toContainText('120');
    await expect(tooLong).toContainText('75');
  });

  test('marks a stay that continues past the end of the month', async ({ page }) => {
    await page.goto(JULY_2010);
    // M/V NORTHERN HARBOR runs 2010-07-17 to 2010-08-01.
    const clipped = page.locator('.bar', { hasText: 'NORTHERN HARBOR' }).first();
    await expect(clipped).toBeVisible();
    await expect(clipped.locator('.clip')).toHaveCount(1);
  });

  test('shows the same stay clipped at the START in the following month', async ({ page }) => {
    await page.goto('/?y=2010&m=8');
    // In August this stay is a single day (Aug 1), too narrow to carry visible text, so
    // it is located by its accessible name — which must still identify it completely.
    const clipped = page.getByLabel(/NORTHERN HARBOR.*2010-07-17 to 2010-08-01/);
    await expect(clipped).toBeVisible();
    // It must not read as a stay that began on 1 August.
    await expect(clipped.locator('.clip')).toHaveCount(1);
  });

  test('a bar too narrow for text is still fully identified to assistive tech', async ({ page }) => {
    await page.goto('/?y=2010&m=7');
    // Every bar carries its vessel, dates and berth in its accessible name, whether or
    // not there is room to print them.
    const bars = page.locator('.bar');
    const count = await bars.count();
    for (let i = 0; i < Math.min(count, 8); i++) {
      const label = await bars.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label).toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    }
  });

  test('distinguishes unknown-length vessels from confirmed ones', async ({ page }) => {
    await page.goto(JULY_2010);
    // Most of the board is unverifiable; that is the point of the view.
    const unknown = await page.locator('.bar.unknown').count();
    expect(unknown).toBeGreaterThan(10);
  });
});

test.describe('creating a booking', () => {
  test('refuses a conflicting booking and says which booking is in the way', async ({ page }) => {
    await page.goto(JULY_2010);
    await page.getByRole('button', { name: '+ New booking' }).click();

    await page.getByPlaceholder('Start typing a vessel name').fill('R/V Long Ketch');
    await page.getByLabel('Berth').selectOption({ label: 'South Float East — 90ft' });
    // OSV AMBER REEF holds this berth 2010-07-05 to 2010-07-10.
    await page.getByLabel('Dates').fill('2010-07-06');
    await page.locator('input[type="date"]').nth(1).fill('2010-07-08');

    const stop = page.locator('.verdict.stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('already occupied');
    await expect(stop).toContainText('OSV AMBER REEF');

    // The hard rule blocks.
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeDisabled();
  });

  test('warns about unverified fit WITHOUT blocking the save', async ({ page }) => {
    await page.goto(JULY_2010);
    await page.getByRole('button', { name: '+ New booking' }).click();

    await page.getByPlaceholder('Start typing a vessel name').fill('R/V Long Ketch');
    await page.getByLabel('Berth').selectOption({ label: 'South Float East — 90ft' });
    await page.getByLabel('Dates').fill('2010-07-22');
    await page.locator('input[type="date"]').nth(1).fill('2010-07-24');

    // Berth is clear, so the hard rule is satisfied...
    await expect(page.locator('.verdict.clear').first()).toBeVisible();
    // ...but the soft rule still has something to say...
    const warn = page.locator('.verdict.warn');
    await expect(warn).toContainText('unverified');
    await expect(warn).toContainText('does not stop you saving');
    // ...and it does not block.
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
  });

  test('creates a booking, shows it on the board, then cancels it again', async ({ page }) => {
    // Uses an empty berth/date window and cleans up, so the demo data is unchanged.
    await page.goto('/?y=2019&m=11');
    const before = await page.locator('.bar').count();

    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByRole('button', { name: 'Event', exact: true }).click();
    await page.getByLabel('Description').fill('E2E test event');
    await page.getByLabel('Berth').selectOption({ label: 'Inner Channel — 55ft' });
    await page.getByLabel('Dates').fill('2019-11-14');
    await page.locator('input[type="date"]').nth(1).fill('2019-11-16');

    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save booking' }).click();

    const created = page.locator('.bar', { hasText: 'E2E test event' });
    await expect(created).toBeVisible();
    expect(await page.locator('.bar').count()).toBe(before + 1);

    // Cancel it through the UI and confirm the berth is free again.
    page.on('dialog', (d) => d.accept());
    await created.click();
    await expect(page.getByRole('heading', { name: 'E2E test event' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel booking' }).click();

    await expect(page.locator('.bar', { hasText: 'E2E test event' })).toHaveCount(0);
    await expect.poll(async () => page.locator('.bar').count()).toBe(before);
  });
});

test.describe('the other tabs', () => {
  test('Vessels lists the biggest data gaps first and states the leverage', async ({ page }) => {
    await page.goto('/vessels');
    await expect(page.getByText(/vessels have no recorded length/)).toBeVisible();
    await expect(page.getByText(/bookings verifiable/)).toBeVisible();
    // The vessel blocking the most bookings must be at the top.
    const firstRow = page.locator('table.tbl tbody tr').first();
    await expect(firstRow).toContainText('Long Ketch');
  });

  test('Review surfaces the historical conflict that was kept rather than discarded', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByText('Unresolved conflict').first()).toBeVisible();
    await expect(page.getByText(/OSV AMBER REEF/).first()).toBeVisible();
    // Provenance back to the original spreadsheet cell.
    await expect(page.getByText(/from sheet 2017/).first()).toBeVisible();
  });

  test('every open review item offers an action', async ({ page }) => {
    await page.goto('/review');
    const items = page.locator('.queue li');
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator('.qact .btn')).not.toHaveCount(0);
  });
});
