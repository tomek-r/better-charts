import { expect, test, type Locator, type Page } from '@playwright/test';
import { openChartSettingsDialog } from './helpers/chartSettingsDialog';
import { attachedIndicators, listRows, openIndicators } from './helpers/indicatorsDialog';
import { openSmaSettings } from './helpers/indicatorSettingsDialog';
import { openChart } from './helpers/openChart';
import { failOnPageNoise } from './helpers/pageNoise';
import { gotoWithStub } from './helpers/tauriStub';

/** The full-window backdrop of a modal, which carries `is-closing` while its exit animation plays. */
const BACKDROP_SELECTOR = '.modal-dialog-backdrop';

/** The row the click test presses twice: the moving average, which the dialog attaches on a click. */
const SMA_ROW_TEXT = 'Moving Average Simple';

failOnPageNoise();

/** Opens a dialog, presses Escape, and asserts its backdrop plays the exit before the dialog disappears. */
async function expectEscapeFadesOut(page: Page, open: () => Promise<Locator>): Promise<void> {
  const dialog = await open();

  await page.keyboard.press('Escape');

  await expect(page.locator(BACKDROP_SELECTOR)).toHaveClass(/is-closing/);
  await expect(dialog).toBeHidden();
}

test.describe('modal exit animation', () => {
  test.beforeEach(async ({ page }) => {
    // The fade is an animation, so the browser has to play it rather than the reduced-motion rule cutting it.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoWithStub(page);
    await openChart(page);
  });

  test('Escape fades the chart settings dialog out before it goes', async ({ page }) => {
    await expectEscapeFadesOut(page, () => openChartSettingsDialog(page));
  });

  test('Escape fades the indicator settings dialog out before it goes', async ({ page }) => {
    await expectEscapeFadesOut(page, () => openSmaSettings(page));
  });

  test('under reduced motion Escape drops the dialog without waiting for an animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = await openChartSettingsDialog(page);

    await page.keyboard.press('Escape');

    // No animation plays, so the dialog is already gone when the press returns.
    expect(await dialog.count()).toBe(0);
  });

  test('a second press on an indicator row during the exit attaches the indicator once', async ({ page }) => {
    await openIndicators(page);
    expect(await attachedIndicators(page)).toHaveLength(0);

    await listRows(page).filter({ hasText: SMA_ROW_TEXT }).dblclick();

    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
  });
});
