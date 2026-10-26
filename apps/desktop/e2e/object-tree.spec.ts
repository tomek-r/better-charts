import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  chartDrawings,
  drawingToolbar,
  savedDrawings,
  selectedDrawing,
  TOOLBAR_ACCOUNT_KEY,
  TOOLBAR_SYMBOL,
} from './helpers/drawingToolbarPage';
import { savedProfile } from './helpers/savedProfile';
import { chartDrawingScopeKey, gotoWithStub } from './helpers/tauriStub';

/**
 * The object tree drawer: the drawings of the chart listed topmost first, the click that selects one,
 * the lock, hide and remove buttons a hovered row reveals, the settings dialog a double click opens,
 * and the keys a focused row answers. Every tree locator stays inside the 'Drawings' list, because a
 * selected drawing shows the same command labels on the floating toolbar.
 */

/** The label of the only tool these cases seed, which is also the name of each row. */
const PROFILE_ROW_NAME = 'Fixed range volume profile';

/** The flags of a row that is neither locked nor hidden, which most cases start from. */
const EDITABLE = { locked: false, visible: true };

/** One seeded record, in the shape the stub's backend holds it. */
type SavedProfile = ReturnType<typeof savedProfile>;

/** Every row of the tree, topmost first. */
function drawingRows(page: Page): Locator {
  return page.getByRole('list', { name: 'Drawings' }).getByRole('listitem');
}

/** One row, by the id its saved record was seeded with. */
function drawingRow(page: Page, drawingId: string): Locator {
  return page.getByRole('list', { name: 'Drawings' }).locator(`[data-drawing-id="${drawingId}"]`);
}

/** The name button of a row: what a click, a double click and the row keys land on. */
function rowName(row: Locator): Locator {
  return row.getByRole('button', { name: PROFILE_ROW_NAME, exact: true });
}

/** The price bars row, which sits among the drawings at its place in the stacking order. */
function barsRow(page: Page): Locator {
  return page.getByRole('list', { name: 'Drawings' }).locator('[data-layer="bars"]');
}

/** The name of every row, topmost first: a drawing by its seeded id, the price bars as 'bars'. */
async function layerNames(page: Page): Promise<Array<string | null>> {
  return drawingRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-drawing-id') ?? row.getAttribute('data-layer')),
  );
}

/** One action button of a row, by the label the floating toolbar shares with the tree. */
function rowAction(row: Locator, name: string): Locator {
  return row.getByRole('button', { name, exact: true });
}

/** Opens the drawer from the right-edge strip, which mounts the panel. */
async function openObjectTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Object tree', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Object tree' })).toBeVisible();
}

/** Boots the app with the given profiles saved, waits for them on the chart and opens the tree. */
async function gotoWithSavedProfiles(page: Page, records: readonly SavedProfile[]): Promise<void> {
  await gotoWithStub(page, {
    chartDrawings: { [chartDrawingScopeKey(TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL)]: [...records] },
  });
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(records.length);
  await openObjectTree(page);
}

test('a chart without drawings lists only the price bars', async ({ page }) => {
  await gotoWithStub(page);
  await openObjectTree(page);

  await expect(drawingRows(page)).toHaveCount(1);
  await expect(barsRow(page)).toBeVisible();
  await expect(page.getByText('No drawings yet')).toBeVisible();
});

test('two saved profiles list as rows, the topmost drawing first and the price bars last', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);

  await expect(drawingRows(page)).toHaveCount(3);
  await expect(rowName(drawingRows(page).first())).toHaveText(PROFILE_ROW_NAME);
  expect(await layerNames(page)).toEqual(['second', 'first', 'bars']);
  await expect(barsRow(page).getByRole('button')).toHaveAccessibleName(/^EURUSD/);
});

test('a drawing saved below the price bars lists under the bars row', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', { ...EDITABLE, belowBars: true })]);

  expect(await layerNames(page)).toEqual(['bars', 'first']);
});

test('dragging the price bars row above the top drawing puts every drawing under the bars', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);

  await barsRow(page).dragTo(drawingRow(page, 'second'), { targetPosition: { x: 20, y: 2 } });

  await expect.poll(async () => (await chartDrawings(page)).map((record) => record.belowBars)).toEqual([true, true]);
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.belowBars)).toEqual([true, true]);
  expect(await layerNames(page)).toEqual(['bars', 'second', 'first']);
});

test('dragging a drawing row above another reorders the chart', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);

  await drawingRow(page, 'first').dragTo(drawingRow(page, 'second'), { targetPosition: { x: 20, y: 2 } });

  await expect.poll(async () => (await chartDrawings(page)).map((record) => record.id)).toEqual(['second', 'first']);
});

test('Alt+ArrowUp moves the focused row up and keeps focus on it', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);
  const name = rowName(drawingRow(page, 'first'));

  await name.focus();
  await page.keyboard.press('Alt+ArrowUp');

  await expect.poll(async () => (await chartDrawings(page)).map((record) => record.id)).toEqual(['second', 'first']);
  expect(await layerNames(page)).toEqual(['first', 'second', 'bars']);
  await expect(name).toBeFocused();
});

test('clicking a row selects its drawing and shows the toolbar', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);
  const row = drawingRow(page, 'first');

  await rowName(row).click();

  await expect.poll(async () => (await selectedDrawing(page))?.drawingId).toBe('first');
  await expect(drawingToolbar(page)).toBeVisible();
  await expect(rowName(row)).toHaveAttribute('aria-current', 'true');
});

test('the row lock button locks the drawing, saves it and stays in sight', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);
  const row = drawingRow(page, 'first');
  await row.hover();

  await rowAction(row, 'Lock drawing').click();
  // Pointer and focus leave the row, so only the pressed toggle can keep the button in sight.
  await page.mouse.move(0, 0);
  await page.locator('.chart-host').focus();

  const unlock = rowAction(row, 'Unlock drawing');
  await expect(unlock).toHaveAttribute('aria-pressed', 'true');
  await expect(unlock).toHaveCSS('opacity', '1');
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.locked)).toEqual([true]);
});

test('hiding from the tree saves the drawing hidden, and the row shows it again', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);
  const row = drawingRow(page, 'first');
  await row.hover();

  await rowAction(row, 'Hide drawing').click();

  await expect(row).toHaveAttribute('data-hidden', 'true');
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.visible)).toEqual([false]);

  await rowAction(row, 'Show drawing').click();

  await expect(row).not.toHaveAttribute('data-hidden', 'true');
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.visible)).toEqual([true]);
});

test('removing a row deletes the drawing and focuses the row that takes its place', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);
  const removed = drawingRow(page, 'second');
  await removed.hover();

  await rowAction(removed, 'Remove drawing').click();

  await expect(removed).toHaveCount(0);
  await expect(rowName(drawingRow(page, 'first'))).toBeFocused();
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.id)).toEqual(['first']);
});

test('Delete on a focused row removes its drawing', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);
  const name = rowName(drawingRow(page, 'first'));

  await name.click();
  await name.press('Delete');

  await expect(drawingRows(page)).toHaveCount(1);
  await expect(page.getByText('No drawings yet')).toBeVisible();
  await expect(barsRow(page).getByRole('button')).toBeFocused();
  await expect.poll(async () => (await savedDrawings(page)).length).toBe(0);
});

test('double-clicking a row opens the settings of its drawing', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);

  await rowName(drawingRow(page, 'first')).dblclick();

  await expect(page.getByRole('dialog', { name: `${PROFILE_ROW_NAME} settings` })).toBeVisible();
});

test('locking from the toolbar updates the tree row', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE)]);
  await rowName(drawingRow(page, 'first')).click();

  await drawingToolbar(page).getByRole('button', { name: 'Lock drawing', exact: true }).click();

  await expect(rowAction(drawingRow(page, 'first'), 'Unlock drawing')).toHaveAttribute('aria-pressed', 'true');
});

test('the arrow keys walk the rows and stop at both ends', async ({ page }) => {
  await gotoWithSavedProfiles(page, [savedProfile('first', EDITABLE), savedProfile('second', EDITABLE)]);
  const topRow = rowName(drawingRow(page, 'second'));
  const middleRow = rowName(drawingRow(page, 'first'));
  const bottomRow = barsRow(page).getByRole('button');

  await topRow.focus();
  await page.keyboard.press('ArrowDown');
  await expect(middleRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(bottomRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(bottomRow).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(topRow).toBeFocused();
});
