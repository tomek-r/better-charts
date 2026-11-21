import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PRICE_PANE_GROUP,
  SMA_9_CLOSE,
  indicatorList,
  indicatorRows,
  openObjectTree,
  openSmaSettingsDialog,
  paneGroup,
  paneGroupNames,
  paneIndicatorRows,
  smaSettingsDialog,
} from './helpers/indicatorObjectTree';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';

failOnPageNoise();

/**
 * The indicator rows of the object tree, grouped by chart pane: the price pane holds the drawings and the
 * price-pane indicators, then one group per indicator with a pane of its own, top to bottom, plus the hide,
 * show and remove buttons a hovered row offers, and the settings dialog its name or its settings button
 * opens.
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

/** Saved indicators that draw in panes of their own, and the names their rows carry. */
const SAVED_RSI_14 = { instanceId: 'rsi-1', definitionId: 'rsi', settings: {} };
const SAVED_VOLUME = { instanceId: 'volume-1', definitionId: 'volume', settings: {} };
const RSI_14_CLOSE = 'RSI 14 close';
const VOLUME_ROW_NAME = 'Vol';

/** The groups the chart's own panes get: the price pane counts as pane 1, so they start at pane 2. */
const SECOND_PANE_GROUP = 'Pane 2';
const THIRD_PANE_GROUP = 'Pane 3';

/** The length field of the settings dialog. */
function lengthField(page: Page): Locator {
  return smaSettingsDialog(page).getByRole('spinbutton', { name: 'Length' });
}

/** Boots the app with the given saved indicators and opens the object tree drawer. */
async function openTreeWith(page: Page, savedIndicators: unknown[]): Promise<void> {
  await openWithSavedIndicators(page, savedIndicators);
  await openObjectTree(page);
}

/** Boots the app with one saved moving average on the price pane and opens the object tree drawer. */
async function openTreeWithSavedSma(page: Page): Promise<void> {
  await openTreeWith(page, [SAVED_SMA_9]);
}

/** The single price-pane indicator row, hovered so that its action buttons are in sight. */
async function hoveredIndicatorRow(page: Page): Promise<Locator> {
  const row = indicatorRows(page);
  await row.hover();
  return row;
}

/** Hides the indicator of a row, then waits for the chart to record the flag and dim the row. */
async function hideIndicatorRow(page: Page, row: Locator): Promise<void> {
  await row.getByRole('button', { name: 'Hide indicator', exact: true }).click();
  await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(true);
  await expect(row).toHaveAttribute('data-hidden', 'true');
}

/** Shows the indicator of a row again, then waits for the chart to clear the flag and the dimming. */
async function showIndicatorRow(page: Page, row: Locator): Promise<void> {
  await row.getByRole('button', { name: 'Show indicator', exact: true }).click();
  await expect.poll(async () => (await attachedIndicators(page))[0]?.hidden).toBe(false);
  await expect(row).not.toHaveAttribute('data-hidden', 'true');
}

/** Removes the indicator of a row, then waits for the chart to drop it. */
async function removeIndicatorRow(page: Page, row: Locator): Promise<void> {
  await row.getByRole('button', { name: 'Remove indicator', exact: true }).click();
  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
}

test('an attached indicator is listed under the drawings by its legend name', async ({ page }) => {
  await openTreeWithSavedSma(page);

  await expect(indicatorRows(page)).toHaveCount(1);
  await expect(indicatorRows(page)).toContainText(SMA_9_CLOSE);
});

test('Hide and Show save the hidden flag and dim the row', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await hoveredIndicatorRow(page);
  await hideIndicatorRow(page, row);

  expect(readSavedIndicators(await latestSavedIndicators(page))).toContainEqual(
    expect.objectContaining({ instanceId: SMA_INSTANCE_ID, hidden: true }),
  );

  await showIndicatorRow(page, row);
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
  await removeIndicatorRow(page, row);

  await expect(indicatorList(page)).toHaveCount(0);
});

test('an indicator with a pane of its own is listed in a group of its own', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_9, SAVED_RSI_14]);

  const pricePane = paneGroup(page, PRICE_PANE_GROUP);
  await expect(pricePane.getByRole('list', { name: 'Drawings' })).toBeVisible();
  await expect(paneIndicatorRows(pricePane)).toHaveCount(1);
  await expect(paneIndicatorRows(pricePane)).toContainText(SMA_9_CLOSE);

  const rsiPane = paneGroup(page, SECOND_PANE_GROUP);
  await expect(paneIndicatorRows(rsiPane)).toHaveCount(1);
  await expect(paneIndicatorRows(rsiPane)).toContainText(RSI_14_CLOSE);
  await expect(paneGroup(page, THIRD_PANE_GROUP)).toHaveCount(0);
});

test('pane groups follow the panes top to bottom', async ({ page }) => {
  await openTreeWith(page, [SAVED_RSI_14, SAVED_VOLUME, SAVED_SMA_9]);

  expect(await paneGroupNames(page)).toEqual([PRICE_PANE_GROUP, SECOND_PANE_GROUP, THIRD_PANE_GROUP]);
  await expect(paneIndicatorRows(paneGroup(page, PRICE_PANE_GROUP))).toContainText(SMA_9_CLOSE);
  await expect(paneIndicatorRows(paneGroup(page, SECOND_PANE_GROUP))).toContainText(RSI_14_CLOSE);
  await expect(paneIndicatorRows(paneGroup(page, THIRD_PANE_GROUP))).toContainText(VOLUME_ROW_NAME);
});

test('an own-pane indicator row hides and removes it', async ({ page }) => {
  await openTreeWith(page, [SAVED_RSI_14]);
  const row = paneIndicatorRows(paneGroup(page, SECOND_PANE_GROUP));
  await row.hover();

  await hideIndicatorRow(page, row);
  await removeIndicatorRow(page, row);

  await expect(paneGroup(page, SECOND_PANE_GROUP)).toHaveCount(0);
  await expect(indicatorRows(page)).toHaveCount(0);
});
