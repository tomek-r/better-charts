import { expect, test, type Page } from '@playwright/test';
import { openSavedProfileSettings } from './helpers/savedProfileSettings';

/**
 * The drawing settings dialog on the real app: it hangs from a fixed offset below the window's top edge, so
 * tabs of different height never move it, and the pop-ups opened from it (drop-down list, colour picker)
 * take Escape for themselves instead of closing the whole dialog.
 */

const TABS = ['Inputs', 'Style', 'Coordinates', 'Visibility'];

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Fixed range volume profile settings' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openSavedProfileSettings(page, 'Inputs');
});

test('the dialog keeps its top edge while the tabs change its height', async ({ page }) => {
  const tops = new Set<number>();
  const heights = new Set<number>();
  for (const tab of TABS) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const box = (await settingsDialog(page).boundingBox())!;
    tops.add(box.y);
    heights.add(box.height);
  }

  expect(heights.size).toBeGreaterThan(1);
  expect(tops.size).toBe(1);
  expect([...tops][0]).toBeLessThan(150);
});

test('Escape closes an open drop-down list first and the dialog only when none is open', async ({ page }) => {
  const rowsLayout = page.getByLabel('Rows Layout', { exact: true });
  await rowsLayout.click();
  await expect(page.getByRole('listbox')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
  await expect(rowsLayout).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
});

test('Escape closes an open colour picker first and the dialog only when none is open', async ({ page }) => {
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  const poc = page.getByLabel('POC colour', { exact: true });
  await poc.click();
  const picker = page.getByRole('dialog', { name: 'POC colour options' });
  await expect(picker).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(picker).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
  await expect(poc).toBeFocused();
});

test('a drop-down list opens over the dialog, not clipped by it', async ({ page }) => {
  const dialogBox = (await settingsDialog(page).boundingBox())!;
  await page.getByLabel('Volume', { exact: true }).click();
  const listBox = (await page.getByRole('listbox').boundingBox())!;

  expect(listBox.height).toBeGreaterThan(0);
  expect(listBox.y).toBeGreaterThan(dialogBox.y);
  await expect(page.getByRole('option', { name: 'Delta', exact: true })).toBeInViewport();
});
