import { expect, test, type Page } from '@playwright/test';
import { openChartSettingsDialog } from './helpers/chartSettingsDialog';
import { indicatorsDialog, openIndicators } from './helpers/indicatorsDialog';
import { attachedLength, openSmaSettings, previewLength } from './helpers/indicatorSettingsDialog';
import { openChart } from './helpers/openChart';
import { failOnPageNoise } from './helpers/pageNoise';
import { gotoWithStub } from './helpers/tauriStub';

/** A point 10 px in from the viewport's top-left corner: on a modal's full-window backdrop, clear of its panel. */
const BACKDROP_POINT = 10;
const STORED_LENGTH = 9;
const PREVIEWED_LENGTH = 20;

failOnPageNoise();

async function clickBackdrop(page: Page): Promise<void> {
  await page.mouse.click(BACKDROP_POINT, BACKDROP_POINT);
}

test.beforeEach(async ({ page }) => {
  await gotoWithStub(page);
  await openChart(page);
});

test('a backdrop click closes the chart settings dialog', async ({ page }) => {
  const dialog = await openChartSettingsDialog(page);

  await clickBackdrop(page);

  await expect(dialog).toBeHidden();
});

test('a backdrop click closes the Indicators dialog', async ({ page }) => {
  await openIndicators(page);

  await clickBackdrop(page);

  await expect(indicatorsDialog(page)).toBeHidden();
});

test('a backdrop click closes the indicator settings dialog and puts the stored settings back', async ({ page }) => {
  const dialog = await openSmaSettings(page);
  await previewLength(page, dialog, PREVIEWED_LENGTH);

  await clickBackdrop(page);

  await expect(dialog).toBeHidden();
  await expect.poll(async () => attachedLength(page)).toBe(STORED_LENGTH);
});
