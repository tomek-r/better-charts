import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  SMA_9_CLOSE,
  indicatorList,
  indicatorRows,
  openObjectTree,
  openSmaSettingsDialog,
  smaSettingsDialog,
} from './helpers/indicatorObjectTree';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';

failOnPageNoise();

/**
 * The indicator rows of the object tree: the price-pane indicators listed under the drawings by their
 * legend names, the hide, show and remove buttons a hovered row offers, and the settings dialog its name
 * or its settings button opens.
 */

/** The instance and the definition of the one indicator these cases seed. */
const SMA_INSTANCE_ID = 'sma-1';
const SMA_DEFINITION_ID = 'sma';

/** The name the seeded moving average goes by once its length changed. */
const SMA_20_CLOSE = 'SMA 20 close';

/** The length these cases type into the settings form, and one the form refuses. */
const NEW_LENGTH = 20;
const INVALID_LENGTH = '0';

/** The saved indicator these cases start from: a moving average on default settings. */
const SAVED_SMA_9 = { instanceId: SMA_INSTANCE_ID, definitionId: SMA_DEFINITION_ID, settings: {} };

/** The length field of the settings dialog. */
function lengthField(page: Page): Locator {
  return smaSettingsDialog(page).getByRole('spinbutton', { name: 'Length' });
}

/** Boots the app with one saved moving average on the price pane and opens the object tree drawer. */
async function openTreeWithSavedSma(page: Page): Promise<void> {
  await openWithSavedIndicators(page, [SAVED_SMA_9]);
  await openObjectTree(page);
}

/** The single indicator row, hovered so that its action buttons are in sight. */
async function hoveredIndicatorRow(page: Page): Promise<Locator> {
  const row = indicatorRows(page);
  await row.hover();
  return row;
}

test('an attached indicator is listed under the drawings by its legend name', async ({ page }) => {
  await openTreeWithSavedSma(page);

  await expect(indicatorRows(page)).toHaveCount(1);
  await expect(indicatorRows(page)).toContainText(SMA_9_CLOSE);
});

test('Hide and Show save the hidden flag and dim the row', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await hoveredIndicatorRow(page);
  await row.getByRole('button', { name: 'Hide indicator', exact: true }).click();

  await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(true);
  await expect(row).toHaveAttribute('data-hidden', 'true');
  expect(readSavedIndicators(await latestSavedIndicators(page))).toContainEqual(
    expect.objectContaining({ instanceId: SMA_INSTANCE_ID, hidden: true }),
  );

  await row.getByRole('button', { name: 'Show indicator', exact: true }).click();

  await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(false);
  await expect(row).not.toHaveAttribute('data-hidden', 'true');
});

test('the settings dialog saves a new length and the chart recomputes', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await hoveredIndicatorRow(page);

  await row.getByRole('button', { name: 'Indicator settings', exact: true }).click();
  await expect(smaSettingsDialog(page)).toBeVisible();
  await lengthField(page).fill(String(NEW_LENGTH));
  await smaSettingsDialog(page).getByRole('button', { name: 'OK', exact: true }).click();

  await expect(smaSettingsDialog(page)).toBeHidden();
  await expect.poll(async () => (await attachedIndicators(page))[0]?.settings.length).toBe(NEW_LENGTH);
  await expect(row).toContainText(SMA_20_CLOSE);
  const legendRows = page.getByLabel('Indicator legend', { exact: true }).locator('.chart-indicator-legend-row');
  await expect(legendRows.first()).toContainText(SMA_20_CLOSE);
});

test('an invalid length keeps OK disabled', async ({ page }) => {
  await openTreeWithSavedSma(page);

  const dialog = await openSmaSettingsDialog(page);
  await lengthField(page).fill(INVALID_LENGTH);

  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeDisabled();
});

test('Remove detaches the indicator and drops its row', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await hoveredIndicatorRow(page);
  await row.getByRole('button', { name: 'Remove indicator', exact: true }).click();

  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
  await expect(indicatorList(page)).toHaveCount(0);
});
