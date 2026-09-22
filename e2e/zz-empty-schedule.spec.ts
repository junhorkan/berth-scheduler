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
    // Said once, under the page's name, and no empty card repeating it.
    await expect(page.getByText('Nothing on the schedule needs a decision.')).toHaveCount(1);
    await expect(page.locator('.queue li')).toHaveCount(0);
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

  test('loading the sample brings in 23 years, and the board says where they are', async ({ page }) => {
    // The reload copies 2,031 bookings from the seed snapshot; about 12s.
    test.setTimeout(120_000);
    page.once('dialog', (d) => d.accept());
    await page.goto('/');
    await page.getByRole('button', { name: /load the sample schedule/i }).click();

    // Every booking in the workbook is behind today, so the board's own month is empty —
    // and it says where the bookings are instead of looking like a failed load.
    const note = page.locator('.boardnote');
    await expect(note).toContainText('Nearest bookings', { timeout: 60_000 });
    await note.getByRole('link').click();
    await expect(page.locator('.bar').first()).toBeVisible();

    // What the import found is on Review as history rather than as work: the one real
    // double-booking in 23 years, kept rather than deleted, and no badge demanding a
    // decision about a boat that sailed in 2017. History starts closed — a button per
    // category, and nothing on screen until one is pressed.
    await page.goto('/review');
    const history = page.locator('.board.history');
    await expect(history).toBeVisible();
    await expect(history.locator('.histpanel:visible')).toHaveCount(0);
    // Hide takes no space until there is something to close. It stays in the page
    // rather than being removed, so pressing it cannot take the keyboard's focus with it.
    expect((await history.locator('.histhide').boundingBox())!.width).toBeLessThan(2);
    // And the keyboard reaches the switch. A checked radio is a group's only tab stop,
    // so checking a hidden one to mean "nothing open" skipped every button in it:
    // tabbing out of the card above has to land on the first category.
    await page.locator('.qheadlink').focus();
    await page.keyboard.press('Tab');
    await expect(history.locator('.histbtn input').first()).toBeFocused();

    await history.getByRole('radio', { name: 'Unresolved conflict' }).check();
    await expect(history.getByText('Utility work on pier face')).toBeVisible();
    // One at a time: opening a category closes whatever was open.
    await history.getByRole('radio', { name: 'Could not be read' }).check();
    await expect(history.getByText('Utility work on pier face')).toBeHidden();
    await expect(history.getByText('Ultrasonic pier test')).toBeVisible();
    // And Hide puts the card back to its quiet state.
    await history.getByRole('radio', { name: 'Hide' }).check();
    await expect(history.locator('.histpanel:visible')).toHaveCount(0);
    await expect(page.locator('.tabs .count')).toHaveCount(0);

    // The schedule was empty when this ran, having just been cleared. Loading over an
    // empty schedule must not overwrite the snapshot of what was there before the Clear,
    // or an accidental Load after a Clear would lose it for good.
    await expect(page.getByRole('button', { name: /Put back the previous schedule/ })).toBeVisible();
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

    await makeEvent(page, 'E2E undo the clear', 'Inner Channel — 55ft');

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
    const undo = page.getByRole('button', { name: /Put back the previous schedule/ });
    await expect(undo).toBeVisible();
    await undo.click();

    await expect(page.getByLabel(/E2E undo the clear/)).toBeVisible({ timeout: 60_000 });

    // The offer is gone, because the snapshot was consumed. An undo you can run twice
    // would wipe whatever was done after the first one.
    await expect(page.getByRole('button', { name: /Put back the previous schedule/ })).toHaveCount(0);
  });

  /**
   * Loading the sample replaces the whole schedule, and it used to be the one action
   * that could not be taken back: it deleted visitors' bookings outright and threw away
   * the Clear snapshot as well. It now keeps what it replaced, like Clear does.
   */
  test('loading the sample over your work can be put back', async ({ page }) => {
    test.setTimeout(120_000);
    page.on('dialog', (d) => d.accept());

    // Its own berth: the previous spec's booking is put back on Inner Channel for the same
    // dates, and the constraint would — correctly — refuse a second one there.
    await makeEvent(page, 'E2E keep me', 'South Float East — 90ft');

    await page.goto('/review');
    await page.getByRole('button', { name: /load the sample schedule/i }).click();

    // The sample has nothing in the current month, so the booking is gone from it.
    await expect.poll(async () => {
      await page.goto('/');
      return page.getByLabel(/E2E keep me/).count();
    }, { timeout: 60_000 }).toBe(0);

    await page.goto('/review');
    const putBack = page.getByRole('button', { name: /Put back the previous schedule/ });
    await expect(putBack).toBeVisible();
    await expect(page.getByText(/Replaced by the sample/)).toBeVisible();
    await putBack.click();

    await expect.poll(async () => {
      await page.goto('/');
      return page.getByLabel(/E2E keep me/).count();
    }, { timeout: 60_000 }).toBe(1);
  });
});

/**
 * The case a reviewer constructed against the first version of Put back: after a Load,
 * somebody makes new bookings on the sample, then presses Put back. It deleted them,
 * with nothing to bring them back. Put back is now a swap, so it keeps them.
 */
test.describe('putting back', () => {
  test('is itself undoable: it keeps what it replaces', async ({ page }) => {
    test.setTimeout(150_000);
    page.on('dialog', (d) => d.accept());

    // Whatever the earlier specs left is "your work". Load the sample over it.
    await page.goto('/review');
    await page.getByRole('button', { name: /load the sample schedule/i }).click();
    await expect(page.getByRole('button', { name: /Put back the previous schedule/ }))
      .toBeVisible({ timeout: 60_000 });

    // New work, made on the sample.
    await makeEvent(page, 'E2E made after the load', 'North Pier East — 240ft');

    // Put back the earlier work. The new booking must be kept, not deleted.
    await page.goto('/review');
    await page.getByRole('button', { name: /Put back the previous schedule/ }).click();
    await expect.poll(async () => {
      await page.goto('/');
      return page.getByLabel(/E2E made after the load/).count();
    }, { timeout: 60_000 }).toBe(0);

    await page.goto('/review');
    const again = page.getByRole('button', { name: /Put back the previous schedule/ });
    await expect(again).toBeVisible();
    await expect(page.getByText(/Replaced by Put back/)).toBeVisible();

    // Pressing it again brings the new booking back.
    await again.click();
    await expect.poll(async () => {
      await page.goto('/');
      return page.getByLabel(/E2E made after the load/).count();
    }, { timeout: 60_000 }).toBe(1);
  });
});

/** An event on the given berth from the form's default date, through the real form. */
async function makeEvent(page: import('@playwright/test').Page, label: string, berth: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New booking' }).click();
  await page.getByRole('button', { name: 'Event', exact: true }).click();
  await page.getByLabel('Description').fill(label);
  // selectOption by value: once dates are set the option text gains "· free" or "· taken".
  const select = page.getByLabel('Berth', { exact: true });
  const value = await select.locator('option', { hasText: berth.split(' — ')[0] }).getAttribute('value');
  await select.selectOption(value ?? '');
  const dates = page.locator('input[type="date"]');
  const start = await dates.first().inputValue();
  const day = Number(start.slice(8, 10));
  await dates.nth(1).fill(`${start.slice(0, 8)}${String(Math.min(day + 2, 28)).padStart(2, '0')}`);
  await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save booking' }).click();
  await expect(page.getByLabel(new RegExp(label))).toBeVisible();
}
