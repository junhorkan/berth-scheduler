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

  test('loading the sample puts a live schedule on the front door', async ({ page }) => {
    // The reload copies 2,031 bookings and then places the forward ones; ~12s.
    test.setTimeout(120_000);
    page.once('dialog', (d) => d.accept());
    await page.goto('/');
    await page.getByRole('button', { name: /load the sample schedule/i }).click();

    // The board opens on today, and the sample reaches into it: the first berth is
    // taken from the load day, so the month the board opens to always has a bar.
    await expect(page.locator('.bar').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.boardnote')).toHaveCount(0);

    // The form opens onto that taken berth, so the refusal is the first verdict.
    await page.getByRole('button', { name: '+ New booking' }).click();
    await expect(page.getByText(/Blocked — berth already occupied/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // And a booking that does not fit its berth is on the board two days out — which
    // may be next month, so look where it is rather than only on the front door. The
    // sample also puts a misfit behind the load day, so this counts at least one
    // rather than exactly one.
    const facilityToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const misfitDay = new Date(Date.parse(`${facilityToday}T00:00:00Z`) + 2 * 86_400_000);
    await page.goto(`/?y=${misfitDay.getUTCFullYear()}&m=${misfitDay.getUTCMonth() + 1}`);
    expect(await page.locator('.bar.toolong').count()).toBeGreaterThan(0);

    // The queue asks about the live one only. The one that already sailed is on the
    // board in red and in the archive below, not in the badge — DECISIONS 26.
    await page.goto('/review');
    // Scoped to the work card: this hull was also too long for the same berth in 2010,
    // so it legitimately appears in the archive as well. That is the point of the split.
    const work = page.locator('.board:not(.history)');
    await expect(work.locator('.queue li', { hasText: 'R/V CLEAR TERN' })).toHaveCount(1);
    const history = page.locator('.board.history');
    await expect(history).toBeVisible();
    await expect(history.locator('.queue li', { hasText: 'R/V CLEAR TERN' })).not.toHaveCount(0);
  });

  /**
   * Self-contained: it makes the one booking it is about to lose, rather than leaning
   * on the sample the previous spec loaded. An earlier version read the review badge
   * to check the queue came back, which does not exist when the queue is empty — so
   * the spec hung for three minutes waiting for an element that was correctly absent.
   */
  test('a cleared schedule can be put back', async ({ page }) => {
    test.setTimeout(120_000);
    page.on('dialog', (d) => d.accept());

    await page.goto('/');
    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByRole('button', { name: 'Event', exact: true }).click();
    await page.getByLabel('Description').fill('E2E undo the clear');
    await page.getByLabel('Berth', { exact: true }).selectOption({ label: 'Inner Channel — 55ft' });
    const dates = page.locator('input[type="date"]');
    const start = await dates.first().inputValue();
    const day = Number(start.slice(8, 10));
    await dates.nth(1).fill(`${start.slice(0, 8)}${String(Math.min(day + 2, 28)).padStart(2, '0')}`);
    await page.getByRole('button', { name: 'Save booking' }).click();
    await expect(page.getByLabel(/E2E undo the clear/)).toBeVisible();

    await page.goto('/review');
    await page.getByRole('button', { name: /Clear the schedule/ }).click();

    // Gone: the board draws its seven lanes and nothing else.
    await expect.poll(async () => {
      await page.goto('/');
      return page.locator('.bar').count();
    }, { timeout: 60_000 }).toBe(0);
    await expect(page.locator('.rail')).toHaveCount(7);

    // And the way back is offered where the person is looking — on the empty board,
    // not only on the tab whose button they pressed.
    const undo = page.getByRole('button', { name: /Undo the clear/ });
    await expect(undo).toBeVisible();
    await undo.click();

    await expect(page.getByLabel(/E2E undo the clear/)).toBeVisible({ timeout: 60_000 });

    // The offer is gone, because the snapshot was consumed. An undo you can run twice
    // would wipe whatever was done after the first one.
    await expect(page.getByRole('button', { name: /Undo the clear/ })).toHaveCount(0);
  });
});
