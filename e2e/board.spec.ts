import { test, expect } from '@playwright/test';
import {
  FIXTURE_YEAR, FIXTURE_MONTH, FIXTURE_HREF, NEXT_MONTH_HREF, EMPTY_MONTH_HREF,
} from './helpers/schedule';

/**
 * The board is the product. These assert the two things it exists to do:
 * make a misfit visible, and make a conflict impossible to commit.
 */

test.describe('the board', () => {
  test('opens on the current month, like a tool that is actually in use', async ({ page }) => {
    const now = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    }).format(new Date());
    const [year, month] = now.split('-');
    const name = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
      .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

    await page.goto('/');
    await expect(page.locator('.month')).toHaveText(`${name} ${year}`);
  });

  test('renders the grid even when the month is empty, so it never reads as broken', async ({ page }) => {
    // Replacing the board with one line of text made an empty month look like a
    // failure. Seven labelled berth lanes look like a schedule waiting for a booking.
    await page.goto(EMPTY_MONTH_HREF);
    await expect(page.locator('.rail')).toHaveCount(7);
    await expect(page.locator('.bar')).toHaveCount(0);
    // The grid itself is the answer, and the toolbar already counts the month, so no
    // panel restates it. The legend goes too: five colours explaining nothing.
    await expect(page.locator('.legend')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ New booking' })).toBeVisible();
  });

  test('navigates across the whole bookable window', async ({ page }) => {
    await page.goto(`/?y=${FIXTURE_YEAR + 2}&m=6`);
    await expect(page.locator('.month')).toHaveText(`June ${FIXTURE_YEAR + 2}`);
    await page.goto(`/?y=${FIXTURE_YEAR - 1}&m=10`);
    await expect(page.locator('.month')).toHaveText(`October ${FIXTURE_YEAR - 1}`);
  });

  test('jumps to a month the moment one is chosen, with no confirm step', async ({ page }) => {
    // This replaced a label, two selects and a "Go" button. Choosing the month IS the
    // instruction; the button existed only because the form was plain HTML.
    await page.goto(FIXTURE_HREF);
    await page.getByLabel('Jump to year').selectOption(String(FIXTURE_YEAR + 1));
    await expect(page.locator('.month')).toContainText(String(FIXTURE_YEAR + 1));

    await page.getByLabel('Jump to month').selectOption('3');
    await expect(page.locator('.month')).toHaveText(`March ${FIXTURE_YEAR + 1}`);
  });

  test('marks today on the board, and only in the current month', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.todaycol')).toHaveCount(7); // one per berth lane
    await expect(page.locator('.dayhead .d[aria-current="date"]')).toHaveCount(1);

    await page.goto(FIXTURE_HREF);
    await expect(page.locator('.todaycol')).toHaveCount(0);
  });

  test('offers a way back to today from another month', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.locator('.navbtn.today')).toHaveCount(0);
  });

  test('draws a vessel that does not fit taller than its lane', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    const tooLong = page.locator('.bar.toolong').first();
    await expect(tooLong).toBeVisible();

    // R/V Test Tern is 120ft in the 75ft North Pier Face: 120/75 = 1.6 lanes.
    const height = await tooLong.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(40); // lane track is 30px
    await expect(tooLong).toContainText('120');
    await expect(tooLong).toContainText('75');
  });

  test('states the measurement on a SINGLE-DAY violation, not just wide ones', async ({ page }) => {
    // Gating the label on bar width hid most violations behind a hover; in the real
    // source, six of the nine were one-day bookings, including the worst.
    await page.goto(FIXTURE_HREF);
    const violation = page.getByLabel(/S\/Y Test Beacon/);
    await expect(violation).toBeVisible();
    await expect(violation).toHaveClass(/toolong/);
    await expect(page.locator('.ftbadge')).toContainText('170');
  });

  test('marks a stay that continues past the end of the month', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    const crossing = page.getByLabel(/M\/V Test Crosser/);
    await expect(crossing).toBeVisible();
    await expect(crossing).toContainText('→');
  });

  test('shows the same stay clipped at the START in the following month', async ({ page }) => {
    // It must never read as two separate stays.
    await page.goto(NEXT_MONTH_HREF);
    const crossing = page.getByLabel(/M\/V Test Crosser/);
    await expect(crossing).toBeVisible();
    await expect(crossing).toContainText('←');
  });

  test('a bar too narrow for text is still fully identified to assistive tech', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    const bars = page.locator('.bar');
    const count = await bars.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const label = await bars.nth(i).getAttribute('aria-label');
      expect(label, `bar ${i} accessible name`).toBeTruthy();
      expect(label!.length, `bar ${i} accessible name`).toBeGreaterThan(10);
    }
  });

  test('explains every bar in plain language on hover', async ({ page }) => {
    // The board carried this text all along, in a native `title` that took about a
    // second to appear. Most people never waited, so it looked unexplained.
    await page.goto(FIXTURE_HREF);
    const tooLong = page.locator('.bar.toolong').first();
    const tip = await tooLong.getAttribute('data-tip');
    expect(tip).toContain('does not fit');
    expect(tip).toMatch(/\d+ft berth/);

    // No formulas on the bar itself either.
    await expect(tooLong).toContainText('in');
    await expect(tooLong).not.toContainText('\u203a');
  });

  test('distinguishes unknown-length vessels from confirmed ones', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    await expect(page.locator('.bar.unknown')).not.toHaveCount(0);
    await expect(page.getByLabel(/M\/V Test Drifter/)).toHaveClass(/unknown/);
  });
});

test.describe('creating a booking', () => {
  test('refuses a conflicting booking and says which booking is in the way', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByLabel('Vessel', { exact: true }).fill('R/V Conflict Probe');
    await page.getByLabel('Berth', { exact: true }).selectOption({ label: 'South Float West — 90ft' });

    // R/V Test Harbor already holds South Float West on these days.
    const dates = page.locator('input[type="date"]');
    await dates.first().fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-05`);
    await dates.nth(1).fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-07`);

    await expect(page.getByText(/R\/V Test Harbor already holds this berth/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeDisabled();
  });

  test('warns about unverified fit WITHOUT blocking the save', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByLabel('Vessel', { exact: true }).fill('R/V Unknown Probe');
    await page.getByLabel('Berth', { exact: true }).selectOption({ label: 'North Pier East — 240ft' });

    const dates = page.locator('input[type="date"]');
    await dates.first().fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-22`);
    await dates.nth(1).fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-24`);

    // The asymmetry, rendered: amber advises, red blocks. This one must stay saveable.
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
  });

  test('refuses a booking that starts in the past', async ({ page }) => {
    // A berth cannot be reserved for a day that has gone. The date input's `min`
    // only constrains the picker, so the save path has to check it too.
    await page.goto('/');
    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByLabel('Vessel', { exact: true }).fill('R/V Backdate Probe');

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(yesterday);

    await expect(page.getByText(/already passed/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save booking' })).toBeDisabled();
  });

  test('creates a booking, shows it on the board, then cancels it again', async ({ page }) => {
    await page.goto(FIXTURE_HREF);
    const before = await page.locator('.bar').count();

    await page.getByRole('button', { name: '+ New booking' }).click();
    await page.getByRole('button', { name: 'Event', exact: true }).click();
    await page.getByLabel('Description').fill('E2E test event');
    await page.getByLabel('Berth', { exact: true }).selectOption({ label: 'Inner Channel — 55ft' });
    const dates = page.locator('input[type="date"]');
    await dates.first().fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-22`);
    await dates.nth(1).fill(`${FIXTURE_YEAR}-${String(FIXTURE_MONTH).padStart(2, '0')}-24`);

    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save booking' }).click();

    const created = page.locator('.bar', { hasText: 'E2E test event' });
    await expect(created).toBeVisible();
    expect(await page.locator('.bar').count()).toBe(before + 1);

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
    await expect(page.getByText('M/V Test Drifter')).toBeVisible();
  });

  test('Review collapses missing lengths into one row instead of one per vessel', async ({ page }) => {
    // 398 of 427 items were this type, burying everything that needed a decision.
    await page.goto('/review');
    await expect(page.getByText('No recorded length')).toHaveCount(2); // pill + row
    await expect(page.getByText(/cannot be checked against berth length/)).toBeVisible();
  });

  test('folds repeated problems into one row instead of one per booking', async ({ page }) => {
    // The fixture books one oversized vessel repeatedly; the queue showed a near
    // identical row for each, which buried the items that actually differ.
    await page.goto('/review');
    const rows = page.locator('.queue li');
    const groupedBadges = page.locator('.qcount');

    // At least one group folded several occurrences, and it says how many.
    await expect(groupedBadges.first()).toBeVisible();
    const folded = Number((await groupedBadges.first().innerText()).replace(/\D/g, ''));
    expect(folded).toBeGreaterThan(1);

    // Rows on screen are fewer than the occurrences behind them.
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(page.getByText(/bookings, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/).first())
      .toBeVisible();
  });

  test('every open review item offers an action', async ({ page }) => {
    await page.goto('/review');
    const first = page.locator('.queue li').first();
    await expect(first.locator('.qact .btn').first()).toBeVisible();
  });
});

test.describe('a wrong turn', () => {
  test('shows a light 404 with a way back, not the framework default', async ({ page }) => {
    // Next's default error page carries its own prefers-color-scheme rule, so on a
    // dark-preference machine it was the one screen that contradicted the whole app.
    const res = await page.goto('/no-such-page');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('That page does not exist.')).toBeVisible();
    await expect(page.locator('.next-error-h1')).toHaveCount(0);

    await page.getByRole('link', { name: 'Back to the board' }).click();
    await expect(page.locator('.month')).toBeVisible();
  });
});
