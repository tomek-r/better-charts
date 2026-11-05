import { expect, test, type Locator, type Page } from '@playwright/test';
import { chartSettingsDialog } from './helpers/chartSettingsDialog';
import { openChart } from './helpers/openChart';
import { failOnPageNoise } from './helpers/pageNoise';
import { gotoWithStub } from './helpers/tauriStub';

failOnPageNoise();

/** The Settings button at the far right of the chart header, which opens the chart's settings dialog. */

const HEADER_ROW = '.chart-header-tools';
const SETTINGS_LABEL = 'Settings';
/** How far the row's last button may end from the row's own right edge: the flex row leaves no gap. */
const EDGE_TOLERANCE_PX = 2;

/** The header's Settings button: exact, so the topbar's "App settings" never matches. */
function settingsButton(page: Page): Locator {
  return page.getByRole('button', { name: SETTINGS_LABEL, exact: true });
}

/** The right edge of `locator`; fails when the element has no layout box. */
async function rightEdge(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('The measured element has no layout box.');
  }
  return box.x + box.width;
}

test('the Settings button ends the header row at its far right', async ({ page }) => {
  await gotoWithStub(page);
  await openChart(page);

  const rowRight = await rightEdge(page.locator(HEADER_ROW));
  const settingsRight = await rightEdge(settingsButton(page));

  expect(settingsRight).toBeLessThanOrEqual(rowRight);
  expect(rowRight - settingsRight).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
});

test('the header Settings button opens the chart settings dialog', async ({ page }) => {
  await gotoWithStub(page);
  await openChart(page);

  await settingsButton(page).click();

  const dialog = chartSettingsDialog(page);
  await expect(dialog).toBeVisible();
  // The button asks for no tab, so the dialog opens on the first of them.
  await expect(dialog.getByRole('tab', { name: 'Symbol' })).toHaveAttribute('aria-selected', 'true');
});
