import { expect, test, type Page } from '@playwright/test';
import {
  chartDrawings,
  clickChartPoint,
  drawingToolbar,
  placeProfileWithToolbar,
  savedDrawings,
  selectedDrawing,
} from './helpers/drawingToolbarPage';
import { ready } from './helpers/fixedRangeProfilePage';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * The floating toolbar of the selected drawing: when it appears, its five buttons, the lock, hide and
 * remove commands it sends, the settings dialog it opens, dragging it inside the chart frame, and its
 * keys.
 */

/** The toolbar's buttons, in the order they must read from left to right. */
const TOOLBAR_BUTTONS = ['Move toolbar', 'Drawing settings', 'Lock drawing', 'Hide drawing', 'Remove drawing'];

/** Every bar of the toolbar, left to right. */
async function toolbarButtonLefts(page: Page): Promise<number[]> {
  const boxes = await Promise.all(
    TOOLBAR_BUTTONS.map((label) => page.getByRole('button', { name: label, exact: true }).boundingBox()),
  );
  return boxes.map((box) => Math.round(box?.x ?? Number.NaN));
}

test('no toolbar appears before a drawing exists, and clicking the empty chart shows none', async ({ page }) => {
  await gotoWithStub(page);
  await ready(page);

  await expect(drawingToolbar(page)).toHaveCount(0);
  expect(await selectedDrawing(page)).toBeNull();

  await clickChartPoint(page, 4);
  await expect(drawingToolbar(page)).toHaveCount(0);
});

test('a placed drawing is selected and its toolbar reads grip, settings, lock, hide, remove', async ({ page }) => {
  await placeProfileWithToolbar(page);

  expect((await selectedDrawing(page))?.toolId).toBe('fixedRangeProfile');
  const lefts = await toolbarButtonLefts(page);
  expect(lefts).toEqual([...lefts].sort((first, second) => first - second));
  for (const label of TOOLBAR_BUTTONS) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('title', label);
  }
});

test('the lock button locks the drawing, saves it, and unlocks it again', async ({ page }) => {
  await placeProfileWithToolbar(page);
  const lock = page.getByRole('button', { name: 'Lock drawing', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');

  await lock.click();

  const unlock = page.getByRole('button', { name: 'Unlock drawing', exact: true });
  await expect(unlock).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await selectedDrawing(page))?.locked).toBe(true);
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.locked)).toEqual([true]);

  await unlock.click();

  await expect(page.getByRole('button', { name: 'Lock drawing', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect.poll(async () => (await selectedDrawing(page))?.locked).toBe(false);
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.locked)).toEqual([false]);
});

test('hide hides the drawing, saves it hidden, drops the toolbar and frees the chart', async ({ page }) => {
  await placeProfileWithToolbar(page);

  await page.getByRole('button', { name: 'Hide drawing', exact: true }).click();

  await expect(drawingToolbar(page)).toHaveCount(0);
  await expect(page.locator('.chart-host')).toBeFocused();
  await expect.poll(async () => (await chartDrawings(page)).map((record) => record.visible)).toEqual([false]);
  await expect.poll(async () => (await savedDrawings(page)).map((record) => record.visible)).toEqual([false]);
});

test('remove deletes the drawing, hides the toolbar, saves the empty set and frees the chart', async ({ page }) => {
  await placeProfileWithToolbar(page);
  expect(await chartDrawings(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Remove drawing', exact: true }).click();

  await expect(drawingToolbar(page)).toHaveCount(0);
  await expect(page.locator('.chart-host')).toBeFocused();
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(0);
  await expect.poll(async () => savedDrawings(page)).toEqual([]);
});

test('settings opens the drawing dialog, which has its Coordinates and Visibility tabs, and Escape closes it', async ({
  page,
}) => {
  await placeProfileWithToolbar(page);

  await page.getByRole('button', { name: 'Drawing settings', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Fixed range volume profile settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveText(['Inputs', 'Style', 'Coordinates', 'Visibility']);

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(drawingToolbar(page)).toBeVisible();
});

test('dragging the grip moves the toolbar and keeps it inside the chart frame', async ({ page }) => {
  await placeProfileWithToolbar(page);
  const frame = (await page.locator('.chart-frame').boundingBox())!;
  const before = (await drawingToolbar(page).boundingBox())!;
  const grip = (await page.getByRole('button', { name: 'Move toolbar', exact: true }).boundingBox())!;

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // Far past the frame's top-left corner, which the drag must clamp.
  await page.mouse.move(2, 2, { steps: 6 });
  await page.mouse.up();

  const after = (await drawingToolbar(page).boundingBox())!;
  expect(Math.round(after.x)).toBeLessThan(Math.round(before.x));
  expect(Math.round(after.y)).toBeLessThan(Math.round(before.y));
  expect(Math.round(after.x)).toBe(Math.round(frame.x));
  expect(Math.round(after.y)).toBe(Math.round(frame.y));
  expect(Math.round(after.x + after.width)).toBeLessThanOrEqual(Math.round(frame.x + frame.width));
  expect(Math.round(after.y + after.height)).toBeLessThanOrEqual(Math.round(frame.y + frame.height));
});

test('the arrow keys move focus across the toolbar buttons and wrap around', async ({ page }) => {
  await placeProfileWithToolbar(page);
  const grip = page.getByRole('button', { name: 'Move toolbar', exact: true });

  await grip.focus();
  await expect(grip).toBeFocused();

  for (const label of ['Drawing settings', 'Lock drawing', 'Hide drawing', 'Remove drawing', 'Move toolbar']) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: label, exact: true })).toBeFocused();
  }

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Remove drawing', exact: true })).toBeFocused();
});
