import { test, expect } from '@playwright/test';
import {
  clearSchedule, loadSample, putBackSchedule, heldSnapshotKind, isoPlusDays,
} from './helpers/schedule';

/**
 * The empty schedule: what a fresh facility sees, and the way back from one.
 *
 * Named to sort last, because it empties the fixture every other spec depends on.
 *
 * **No button on the site replaces the schedule any more.** Clear went first; Load and
 * Put back have now gone the same way, for the reason that removed Clear — on a public
 * page with no accounts, nothing should be able to replace everyone's data in one press.
 * All three are the command line's (`npm run sample:load`, `npm run put:back`) and these
 * specs call the same mutations through `helpers/schedule`.
 *
 * So every state those specs reached is still reached and still asserted: an empty board,
 * a board holding 23 years, a schedule put back over one that replaced it, and the
 * snapshot slot each of them leaves. What is gone is only the press, which no visitor can
 * perform — and the caption that named the snapshot, which is why the snapshot's own kind
 * is read from the slot (`heldSnapshotKind`) rather than off the page.
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

  test('offers the one thing a visitor can honestly do, and nothing that replaces everyone', async ({ page }) => {
    // It used to offer the sample here — "Restore the original schedule" — and the undo
    // for it at the foot of Review. Both are gone: a visitor with no account must not be
    // able to replace 23 years of somebody else's schedule in one press, and loading the
    // workbook is `npm run import`, behind the database credentials.
    //
    // What is left is not a dead end. An empty board still explains itself, and it points
    // at the one action that is a visitor's to take.
    await page.goto('/');
    const note = page.locator('.boardnote');
    await expect(note).toContainText('The schedule is empty.');
    await expect(note).toContainText('Start with');
    await expect(page.getByRole('button', { name: '+ New booking' })).toBeVisible();

    const replaces = /restore the original schedule|put back the previous schedule|load the sample|clear the schedule/i;
    await expect(page.getByRole('button', { name: replaces })).toHaveCount(0);

    // Nor at the foot of Review, where the pair of them lived.
    await page.goto('/review');
    await expect(page.getByRole('button', { name: replaces })).toHaveCount(0);
    await expect(page.locator('.sampledata')).toHaveCount(0);
  });

  test('has an empty review queue and no badge', async ({ page }) => {
    await page.goto('/review');
    await expect(page.locator('.queue li')).toHaveCount(0);
    // The badge should be absent entirely, not showing a zero.
    await expect(page.locator('.tabs .count')).toHaveCount(0);

    // Empty is a state, not a missing page: the line under the name says what Review
    // is FOR, and each row still stands there with its count and what would fill it.
    // Both used to vanish, which left a masthead with nothing under it at all.
    await expect(page.locator('.hero .tagline'))
      .toHaveText('Problems with the schedule, and what to do about them.');
    for (const name of ['Needs a decision', 'No length on record', 'Cancelled bookings']) {
      await expect(page.getByRole('heading', { name: new RegExp(name, 'i') })).toHaveCount(1);
    }
    await expect(page.locator('.qhcount').first()).toHaveText('0');
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
    await dates.nth(1).fill(isoPlusDays(start, 3));

    await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save booking' }).click();

    // By accessible name, not bar text: a short bar suppresses its visible label.
    const created = page.getByLabel(/R\/V Test Cutter/);
    await expect(created).toBeVisible();

    // The registry now knows it, so a length can be recorded and fit-checking begins.
    await page.goto('/vessels');
    await expect(page.getByText('R/V Test Cutter')).toBeVisible();
  });

  test('an emptied schedule keeps the berths and nothing else', async ({ page }) => {
    // Emptying is no longer something a visitor can do — it is a fixture and
    // command-line operation — but an empty schedule is still a state the product
    // supports, and the state every spec below starts from. No poll and no dialog: the
    // mutation is awaited here rather than fired at a server action by a click.
    await clearSchedule();

    // The vessel the spec above registered goes with its booking. The register INNER
    // JOINs bookings, so a hull with nothing on the schedule is not on it (invariant 2).
    await page.goto('/vessels');
    await expect(page.getByText('R/V Test Cutter')).toHaveCount(0);

    // Berths are the facility, not schedule data, so they survive (invariant 5).
    await page.goto('/');
    await expect(page.locator('.rail')).toHaveCount(7);
    await expect(page.locator('.bar')).toHaveCount(0);
  });

  test('restoring brings back 23 years, and the board says where they are', async ({ page }) => {
    // The reload copies 2,031 bookings from the seed snapshot; about 12s. No button does
    // it any more, so the spec calls the mutation the removed button called — the same one
    // `npm run sample:load` runs.
    test.setTimeout(120_000);
    await loadSample();
    await page.goto('/');

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
    await page.locator('.qheadlink').first().focus();
    await page.keyboard.press('Tab');
    await expect(history.locator('.catbtn input').first()).toBeFocused();

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

    // The schedule was empty when this ran, the spec above having emptied it. Loading over
    // an empty schedule must not overwrite the snapshot of what was there before it — or
    // one run of `sample:load` on an empty board would lose it for good.
    //
    // That the slot is still full does not prove it on its own: a load that wrongly
    // snapshotted the empty schedule would also leave one. The kind is the evidence, and
    // it has to still be the Clear that the spec above took.
    expect(await heldSnapshotKind()).toBe('clear');
  });

  test('the register pages through the vessels instead of growing a list', async ({ page }) => {
    // Runs on the sample the spec above loaded: 398 hulls with no length, 20 with one.
    await page.goto('/vessels');
    const range = page.locator('.prange');
    await expect(range).toHaveText('1–10 of 398');
    await expect(page.locator('.queue li')).toHaveCount(10);

    await page.getByLabel('Next page').click();
    await expect(range).toHaveText('11–20 of 398');
    await expect(page.locator('.queue li')).toHaveCount(10);

    // Switching category starts that list at its own first page. `exact`, because the
    // other button's name — "No length on record" — contains this one's whole name.
    await page.getByRole('button', { name: 'Length on record', exact: true }).click();
    await expect(range).toHaveText('1–10 of 20');
    await expect(page.getByLabel('Previous page')).toBeDisabled();
  });

  /**
   * Emptying the schedule and putting it back are both off the page now, but an empty
   * schedule that cannot be undone would still be a data-loss bug, and the snapshot is
   * taken by the mutation rather than by the button that used to press it.
   *
   * Self-contained: it makes, through the real form, the one booking it is about to lose,
   * rather than leaning on the sample the previous spec loaded. An earlier version read
   * the review badge to check the queue came back, which does not exist when the queue is
   * empty — so the spec hung for three minutes waiting for an element correctly absent.
   */
  test('an emptied schedule can be put back', async ({ page }) => {
    test.setTimeout(120_000);

    await makeEvent(page, 'E2E undo the emptying', 'Inner Channel — 55ft');

    await clearSchedule();
    expect(await heldSnapshotKind()).toBe('clear');

    // Gone: the board draws its seven lanes and nothing else.
    await page.goto('/');
    await expect(page.locator('.bar')).toHaveCount(0);
    await expect(page.locator('.rail')).toHaveCount(7);

    // And the way back brings the booking back, on the board, not merely in a row count.
    await putBackSchedule();
    await page.goto('/');
    await expect(page.getByLabel(/E2E undo the emptying/)).toBeVisible();

    // The slot is empty, because the snapshot was consumed and the empty schedule it
    // replaced had nothing to lose. An undo held open would wipe whatever was done after
    // the first one; `npm run put:back` says "nothing to put back" rather than offering it.
    expect(await heldSnapshotKind()).toBeNull();
  });

  /**
   * Loading the sample replaces the whole schedule, and it used to be the one action
   * that could not be taken back: it deleted visitors' bookings outright, and threw away
   * the snapshot of whatever was there before them as well. It now keeps what it replaced.
   */
  test('loading the sample over your work can be put back', async ({ page }) => {
    test.setTimeout(120_000);

    // Its own berth: the previous spec's booking is back on Inner Channel for the same
    // dates, and the constraint would — correctly — refuse a second one there.
    await makeEvent(page, 'E2E keep me', 'South Float East — 90ft');

    await loadSample();
    // What it displaced is held, and the slot says which action displaced it.
    expect(await heldSnapshotKind()).toBe('load');

    // The sample has nothing in the current month, so the booking is gone from the board.
    await page.goto('/');
    await expect(page.getByLabel(/E2E keep me/)).toHaveCount(0);

    await putBackSchedule();
    await page.goto('/');
    await expect(page.getByLabel(/E2E keep me/)).toBeVisible();
  });
});

/**
 * The case a reviewer constructed against the first version of Put back: after a Load,
 * somebody makes new bookings on the sample, then puts back. It deleted them, with
 * nothing to bring them back. Put back is now a swap, so it keeps them.
 */
test.describe('putting back', () => {
  test('is itself undoable: it keeps what it replaces', async ({ page }) => {
    test.setTimeout(150_000);

    // Whatever the earlier specs left is "your work". Load the sample over it.
    await loadSample();
    expect(await heldSnapshotKind()).toBe('load');

    // New work, made on the sample through the form.
    await makeEvent(page, 'E2E made after the load', 'North Pier East — 240ft');

    // Put back the earlier work. The new booking must be kept, not deleted.
    await putBackSchedule();
    await page.goto('/');
    await expect(page.getByLabel(/E2E made after the load/)).toHaveCount(0);

    // Kept where a swap keeps it, and the slot names the action that took it.
    expect(await heldSnapshotKind()).toBe('restore');

    // Running it again brings the new booking back.
    await putBackSchedule();
    await page.goto('/');
    await expect(page.getByLabel(/E2E made after the load/)).toBeVisible();
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
  // Two days on, crossing into the next month if today is near the end of this one. This
  // read `min(day + 2, 28)`, which on the 29th put the end BEFORE the start.
  await dates.nth(1).fill(isoPlusDays(start, 2));
  await expect(page.getByRole('button', { name: 'Save booking' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save booking' }).click();
  await expect(page.getByLabel(new RegExp(label))).toBeVisible();
}
