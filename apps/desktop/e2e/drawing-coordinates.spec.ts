import { expect, test, type Page } from '@playwright/test';
import { chartDrawings, savedDrawings, TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL } from './helpers/drawingToolbarPage';
import { savedProfile } from './helpers/savedProfile';
import { chartDrawingScopeKey, gotoWithStub, STUB_M5_INTERVAL_MS, STUB_NOW } from './helpers/tauriStub';

/**
 * The Coordinates tab of a saved fixed range volume profile on the real app: one row per anchor with its
 * UTC date and time, an edit applied with OK to the chart and to the saved record, and OK held back
 * while a field is invalid. Every time derives from the stub clock, which the seeded record uses too.
 */

const WINDOW_START_MS = STUB_NOW - 8 * STUB_M5_INTERVAL_MS;
const WINDOW_END_MS = STUB_NOW - 3 * STUB_M5_INTERVAL_MS;
/** An earlier bar still after the window's start. */
const EARLIER_END_MS = STUB_NOW - 5 * STUB_M5_INTERVAL_MS;

/** The text a date and a time field show for an instant, in UTC. */
function utcFieldTexts(timeMs: number): { date: string; time: string } {
  const iso = new Date(timeMs).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

/** The anchors of a profile window, the way the chart exports and the backend stores them. */
function windowPoints(startMs: number, endMs: number) {
  return [
    { timeMs: startMs, price: null },
    { timeMs: endMs, price: null },
  ];
}

function okButton(page: Page) {
  return page.getByRole('button', { name: 'OK', exact: true });
}

/** Boots the app with one saved profile and opens its settings from the object tree, on the Coordinates tab. */
async function openSavedProfileCoordinates(page: Page): Promise<void> {
  const scopeKey = chartDrawingScopeKey(TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL);
  const seeded = savedProfile('seeded', { locked: false, visible: true });
  await gotoWithStub(page, { chartDrawings: { [scopeKey]: [seeded] } });
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Object tree', exact: true }).click();
  await page
    .getByRole('list', { name: 'Drawings' })
    .getByRole('button', { name: 'Fixed range volume profile', exact: true })
    .dblclick();
  await page.getByRole('tab', { name: 'Coordinates', exact: true }).click();
}

/** Types a UTC instant into the date and time fields of one anchor row. */
async function editAnchor(page: Page, label: string, timeMs: number): Promise<void> {
  const { date, time } = utcFieldTexts(timeMs);
  await page.getByLabel(`${label} date`, { exact: true }).fill(date);
  await page.getByLabel(`${label} time`, { exact: true }).fill(time);
}

test('the Coordinates tab lists the two anchors with their UTC date and time and no price', async ({ page }) => {
  await openSavedProfileCoordinates(page);

  await expect(page.getByRole('tab')).toHaveText(['Coordinates']);
  await expect(page.getByRole('tabpanel').getByRole('group')).toHaveCount(2);
  for (const [label, timeMs] of [
    ['#1', WINDOW_START_MS],
    ['#2', WINDOW_END_MS],
  ] as const) {
    const { date, time } = utcFieldTexts(timeMs);
    await expect(page.getByLabel(`${label} date`, { exact: true })).toHaveValue(date);
    await expect(page.getByLabel(`${label} time`, { exact: true })).toHaveValue(time);
    await expect(page.getByLabel(`${label} price`, { exact: true })).toHaveCount(0);
  }
});

test('moving the second anchor to an earlier bar and pressing OK updates the chart and the saved record', async ({
  page,
}) => {
  await openSavedProfileCoordinates(page);

  await editAnchor(page, '#2', EARLIER_END_MS);
  await okButton(page).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved = windowPoints(WINDOW_START_MS, EARLIER_END_MS);
  await expect.poll(async () => (await chartDrawings(page)).map((record) => record.points)).toEqual([moved]);
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.points)).toEqual([moved]);
  expect((await chartDrawings(page))[0].id).toBe('seeded');
});

test('an empty or missing time keeps OK disabled until it is filled again', async ({ page }) => {
  await openSavedProfileCoordinates(page);
  const time = page.getByLabel('#2 time', { exact: true });

  await time.fill('');
  await expect(time).toHaveAttribute('aria-invalid', 'true');
  await expect(okButton(page)).toBeDisabled();

  await time.fill(utcFieldTexts(WINDOW_END_MS).time);
  await expect(okButton(page)).toBeEnabled();
});

test('anchors the tool refuses keep the dialog open with the edits, show an alert and change nothing', async ({
  page,
}) => {
  await openSavedProfileCoordinates(page);
  const beforeStart = WINDOW_START_MS - STUB_M5_INTERVAL_MS;

  await editAnchor(page, '#2', beforeStart);
  await okButton(page).click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText("These points don't make a valid drawing.");
  await expect(page.getByRole('tab', { name: 'Coordinates', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('#2 time', { exact: true })).toHaveValue(utcFieldTexts(beforeStart).time);
  const unchanged = windowPoints(WINDOW_START_MS, WINDOW_END_MS);
  expect((await chartDrawings(page)).map((record) => record.points)).toEqual([unchanged]);
  expect((await savedDrawings(page)).map((record) => record.points)).toEqual([unchanged]);

  await page.getByLabel('#2 time', { exact: true }).fill(utcFieldTexts(WINDOW_END_MS).time);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('OK with the anchors untouched keeps the anchors as they were', async ({ page }) => {
  await openSavedProfileCoordinates(page);

  await okButton(page).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const unchanged = windowPoints(WINDOW_START_MS, WINDOW_END_MS);
  expect((await chartDrawings(page)).map((record) => record.points)).toEqual([unchanged]);
});
