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
  pricePaneLegendRow,
  selectedIndicatorId,
  smaSettingsDialog,
} from './helpers/indicatorObjectTree';
import { chartDrawings, clickChartPoint, selectedDrawing } from './helpers/drawingToolbarPage';
import { CHART_HOST_SELECTOR } from './helpers/chartHost';
import { rgbText } from './helpers/cssColor';
import { drawnIndicators } from './helpers/indicatorFrames';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { openChart } from './helpers/openChart';
import { failOnPageNoise } from './helpers/pageNoise';
import { savedProfile } from './helpers/savedProfile';
import { EURUSD_CHART, latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { gotoWithStub } from './helpers/tauriStub';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';
import { palette } from '../src/shared/theme/palette';

failOnPageNoise();

/**
 * The indicator rows of the object tree, grouped by chart pane: the price pane holds the drawings and the
 * price-pane indicators, then one group per indicator with a pane of its own, top to bottom, plus the hide,
 * show and remove buttons a hovered row offers, the settings dialog its name or its settings button opens,
 * and the one selection the chart holds: a click on a row selects that indicator, frames its legend row
 * and draws its handles, and Escape, Delete, a chart click or a drawing's own selection end it.
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

/** The drawing the one-selection case seeds beside the moving average. */
const SELECTED_DRAWING_ID = 'profile-1';
const DRAWING_ROW_NAME = 'Fixed range volume profile';
const EDITABLE_DRAWING = { locked: false, visible: true };

/** The bar slot of the stub's ten-bar window whose pane point the chart-click case presses. */
const CLICKED_BAR = 4;

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

/** Boots the app with the moving average and one saved drawing, for the one-selection cases. */
async function openTreeWithSmaAndDrawing(page: Page): Promise<void> {
  await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { indicators: [SAVED_SMA_9] } },
    chartDrawings: { [EURUSD_CHART]: [savedProfile(SELECTED_DRAWING_ID, EDITABLE_DRAWING)] },
  });
  await openChart(page);
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(1);
  await openObjectTree(page);
  await expect(indicatorRows(page)).toHaveCount(1);
}

/** The name button of the single price-pane indicator row: what a click and the row keys land on. */
function smaRowName(page: Page): Locator {
  return indicatorRows(page).getByRole('button', { name: SMA_9_CLOSE, exact: true });
}

/** The Remove button of the price-pane legend row, which a selected indicator keeps in sight. */
function legendRemoveButton(page: Page): Locator {
  return pricePaneLegendRow(page).getByRole('button', { name: 'Remove indicator', exact: true });
}

/** Clicks the name of the single price-pane indicator row, which selects that indicator. */
async function selectSmaRow(page: Page): Promise<Locator> {
  await smaRowName(page).click();
  await expect.poll(() => selectedIndicatorId(page)).toBe(SMA_INSTANCE_ID);
  return indicatorRows(page);
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
  await expect(pricePaneLegendRow(page)).toContainText(SMA_20_CLOSE);
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

test('clicking an indicator row selects it, frames its legend row and draws its handles', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await selectSmaRow(page);
  // Pointer and focus leave both rows, so only the selection can frame the row and keep its buttons.
  await page.mouse.move(0, 0);
  await page.locator(CHART_HOST_SELECTOR).focus();

  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(smaRowName(page)).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => (await drawnIndicators(page))[0]?.selectionHandles).toBe(true);

  const legendRow = pricePaneLegendRow(page);
  await expect(legendRow).toHaveAttribute('data-selected', 'true');
  await expect(legendRow).toHaveCSS('border-top-color', rgbText(palette.border));
  await expect(legendRemoveButton(page)).toBeVisible();
});

test('Escape clears the selected indicator and its handles', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const row = await selectSmaRow(page);

  await page.keyboard.press('Escape');

  await expect(row).not.toHaveAttribute('data-selected', 'true');
  await expect(smaRowName(page)).not.toHaveAttribute('aria-current', 'true');
  await expect.poll(() => selectedIndicatorId(page)).toBeNull();
  await expect.poll(async () => (await drawnIndicators(page))[0]?.selectionHandles).toBe(false);
  await expect(legendRemoveButton(page)).toBeHidden();
});

test('Delete on the selected indicator removes it', async ({ page }) => {
  await openTreeWithSavedSma(page);
  await selectSmaRow(page);
  // The chart has the focus, so the press reaches its own key handling before the window shortcut.
  await page.locator(CHART_HOST_SELECTOR).focus();

  await page.keyboard.press('Delete');

  await expect.poll(async () => (await attachedIndicators(page)).length).toBe(0);
  await expect(indicatorList(page)).toHaveCount(0);
  await expect.poll(() => selectedIndicatorId(page)).toBeNull();
});

test('the chart holds one selection: a drawing and an indicator clear each other', async ({ page }) => {
  await openTreeWithSmaAndDrawing(page);
  const drawingName = page
    .getByRole('list', { name: 'Drawings' })
    .locator(`[data-drawing-id="${SELECTED_DRAWING_ID}"]`)
    .getByRole('button', { name: DRAWING_ROW_NAME, exact: true });

  await drawingName.click();
  await expect.poll(async () => (await selectedDrawing(page))?.drawingId).toBe(SELECTED_DRAWING_ID);

  await selectSmaRow(page);
  await expect.poll(() => selectedDrawing(page)).toBeNull();

  await drawingName.click();
  await expect.poll(() => selectedIndicatorId(page)).toBeNull();
  await expect(indicatorRows(page)).not.toHaveAttribute('data-selected', 'true');
  await expect.poll(async () => (await selectedDrawing(page))?.drawingId).toBe(SELECTED_DRAWING_ID);
});

test('clicking the chart clears the selected indicator', async ({ page }) => {
  await openTreeWithSavedSma(page);
  await selectSmaRow(page);

  await clickChartPoint(page, CLICKED_BAR);

  await expect.poll(() => selectedIndicatorId(page)).toBeNull();
  await expect(indicatorRows(page)).not.toHaveAttribute('data-selected', 'true');
});
