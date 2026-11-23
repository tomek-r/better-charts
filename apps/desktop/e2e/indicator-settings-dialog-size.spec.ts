import { expect, test } from '@playwright/test';
import { openSmaSettings } from './helpers/indicatorSettingsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * The indicator settings dialog is wider than a confirmation, so a script's labels and controls sit on one line,
 * and it never runs past the window: a wide, short window once put its bottom below the window's edge and gave
 * the page a scrollbar.
 */

/** The panel width of the indicator settings dialog (the `medium` size token in modal-dialog.css). */
const MEDIUM_WIDTH = 600;
/**
 * A window as wide as a 4K screen and short, but still above the app's own minimum height: the old top gap was a
 * share of the width (307 px here), which put the bottom of the dialog past the window.
 */
const WIDE_SHORT_WINDOW = { width: 3840, height: 600 };

test.describe('indicator settings dialog size', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
  });

  test('the dialog opens at the medium width', async ({ page }) => {
    const dialog = await openSmaSettings(page);

    // The panel opens with a short scale-in, so its width is read once the animation has settled.
    await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(MEDIUM_WIDTH);
  });

  test('in a wide, short window the dialog ends inside it and the page does not scroll', async ({ page }) => {
    await page.setViewportSize(WIDE_SHORT_WINDOW);
    const dialog = await openSmaSettings(page);
    await dialog.getByRole('tab', { name: 'Style', exact: true }).click();

    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(WIDE_SHORT_WINDOW.height);
    const pageHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
    expect(pageHeight).toBeLessThanOrEqual(WIDE_SHORT_WINDOW.height);
  });
});
