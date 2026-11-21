import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PRICE_PANE_GROUP,
  SMA_9_CLOSE,
  expectNoSelectedIndicator,
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
import { emptyPanePoint, plotLinePoint } from './helpers/indicatorPlotPage';
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
 * and the one selection the chart holds: a click on a row or on an indicator's plotted line selects it,
 * frames its legend row and draws its handles, and Escape, Delete, a chart click, a drawing's own selection
 * or another object's click end it.
 */

/** The instance and the definition of the one indicator these cases seed. */
const SMA_INSTANCE_ID = 'sma-1';
const SMA_DEFINITION_ID = 'sma';

/** The second price-pane indicator these cases seed, so that one row can move over another. */
const EMA_INSTANCE_ID = 'ema-1';
const SAVED_EMA_9 = { instanceId: EMA_INSTANCE_ID, definitionId: 'ema', settings: {} };
const EMA_9_CLOSE = 'EMA 9 close';

/** The name the seeded moving average goes by once its length changed. */
const SMA_20_CLOSE = 'SMA 20 close';

/** The length these cases type into the settings form, and one the form refuses. */
const NEW_LENGTH = 20;
const INVALID_LENGTH = '0';

/** The saved indicator these cases start from: a moving average on default settings. */
const SAVED_SMA_9 = { instanceId: SMA_INSTANCE_ID, definitionId: SMA_DEFINITION_ID, settings: {} };

/** A moving average of a single close, so every bar of the stub's window draws a point of its line. */
const SAVED_SMA_OF_ONE = { instanceId: SMA_INSTANCE_ID, definitionId: SMA_DEFINITION_ID, settings: { length: 1 } };

/** The drawn point of the default moving average these clicks aim at: its first, past its nine warm-up bars. */
const WARMED_PLOT_POINT = 0;

/** The drawn point these clicks aim at where a seeded drawing covers the same bar: the stub's fifth slot. */
const CLICKED_PLOT_POINT = 4;

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

/** Boots the app with one saved indicator and one saved drawing, for the one-selection cases. */
async function openTreeWithSmaAndDrawing(page: Page, savedSma: unknown = SAVED_SMA_9): Promise<void> {
  await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { indicators: [savedSma] } },
    chartDrawings: { [EURUSD_CHART]: [savedProfile(SELECTED_DRAWING_ID, EDITABLE_DRAWING)] },
  });
  await openChart(page);
  await expect.poll(async () => (await chartDrawings(page)).length).toBe(1);
  await openObjectTree(page);
  await expect(indicatorRows(page)).toHaveCount(1);
}

/** The name button of one price-pane indicator row, which a click, a double click and the row keys land on. */
function indicatorRowName(page: Page, name: string): Locator {
  return indicatorRows(page).getByRole('button', { name, exact: true });
}

/** The name button of the single price-pane indicator row: what a click and the row keys land on. */
function smaRowName(page: Page): Locator {
  return indicatorRowName(page, SMA_9_CLOSE);
}

/** The names of the price-pane indicator rows, top to bottom. */
async function indicatorRowNames(page: Page): Promise<Array<string | null>> {
  return indicatorRows(page)
    .locator('.object-tree-row-label')
    .evaluateAll((labels) => labels.map((label) => label.textContent));
}

/** The saved indicators' instance ids, in the order the chart settings store them. */
async function savedIndicatorOrder(page: Page): Promise<string[]> {
  return (readSavedIndicators(await latestSavedIndicators(page)) ?? []).map((indicator) => indicator.instanceId);
}

/** The index one indicator's plots hold among its pane's series: the greater it is, the higher it paints. */
async function seriesOrderOf(page: Page, instanceId: string): Promise<number | null> {
  return (await drawnIndicators(page)).find((indicator) => indicator.id === instanceId)?.seriesOrder ?? null;
}

/** Whether the chart paints `top` over `under`: the object tree's top row is the higher series order. */
async function paintsOver(page: Page, top: string, under: string): Promise<boolean> {
  const [topOrder, underOrder] = [await seriesOrderOf(page, top), await seriesOrderOf(page, under)];
  return topOrder !== null && underOrder !== null && topOrder > underOrder;
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

test('the rows follow the saved order, the top one painting over the ones under it', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_9, SAVED_EMA_9]);
  await expect(indicatorRows(page)).toHaveCount(2);

  expect(await indicatorRowNames(page)).toEqual([SMA_9_CLOSE, EMA_9_CLOSE]);
  await expect.poll(() => paintsOver(page, SMA_INSTANCE_ID, EMA_INSTANCE_ID)).toBe(true);
});

test('Alt+ArrowUp moves an indicator row over the one above it, saves the order and paints it on top', async ({
  page,
}) => {
  await openTreeWith(page, [SAVED_SMA_9, SAVED_EMA_9]);
  const emaName = indicatorRowName(page, EMA_9_CLOSE);

  await emaName.focus();
  await page.keyboard.press('Alt+ArrowUp');

  await expect.poll(() => indicatorRowNames(page)).toEqual([EMA_9_CLOSE, SMA_9_CLOSE]);
  await expect(emaName).toBeFocused();
  await expect.poll(() => savedIndicatorOrder(page)).toEqual([EMA_INSTANCE_ID, SMA_INSTANCE_ID]);
  await expect.poll(() => paintsOver(page, EMA_INSTANCE_ID, SMA_INSTANCE_ID)).toBe(true);

  // The saved order is the rows' order, so the reload lists and paints them the same way.
  await page.reload();
  await openChart(page);
  await openObjectTree(page);
  await expect(indicatorRows(page)).toHaveCount(2);
  expect(await indicatorRowNames(page)).toEqual([EMA_9_CLOSE, SMA_9_CLOSE]);
  await expect.poll(() => paintsOver(page, EMA_INSTANCE_ID, SMA_INSTANCE_ID)).toBe(true);
});

test('dragging an indicator row over another moves it there, saves the order and paints it on top', async ({
  page,
}) => {
  await openTreeWith(page, [SAVED_SMA_9, SAVED_EMA_9]);
  const rows = indicatorRows(page);
  await expect(rows).toHaveCount(2);

  await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 2 } });

  await expect.poll(() => indicatorRowNames(page)).toEqual([EMA_9_CLOSE, SMA_9_CLOSE]);
  await expect.poll(() => savedIndicatorOrder(page)).toEqual([EMA_INSTANCE_ID, SMA_INSTANCE_ID]);
  await expect.poll(() => paintsOver(page, EMA_INSTANCE_ID, SMA_INSTANCE_ID)).toBe(true);
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
  await expectNoSelectedIndicator(page);
  await expect.poll(async () => (await selectedDrawing(page))?.drawingId).toBe(SELECTED_DRAWING_ID);
});

test('clicking the chart clears the selected indicator', async ({ page }) => {
  await openTreeWithSavedSma(page);
  await selectSmaRow(page);

  await clickChartPoint(page, CLICKED_BAR);

  await expectNoSelectedIndicator(page);
});

test('clicking a plotted line selects its indicator and points at it', async ({ page }) => {
  await openTreeWithSavedSma(page);
  const line = await plotLinePoint(page, SMA_INSTANCE_ID, WARMED_PLOT_POINT);

  await page.mouse.move(line.x, line.y);
  await expect(page.locator(CHART_HOST_SELECTOR)).toHaveCSS('cursor', 'pointer');

  await page.mouse.click(line.x, line.y);

  await expect.poll(() => selectedIndicatorId(page)).toBe(SMA_INSTANCE_ID);
  await expect(indicatorRows(page)).toHaveAttribute('data-selected', 'true');
  await expect.poll(async () => (await drawnIndicators(page))[0]?.selectionHandles).toBe(true);
  // The click selected rather than cleared: the legend row keeps its buttons in sight, un-hovered.
  await page.mouse.move(0, 0);
  await expect(legendRemoveButton(page)).toBeVisible();
});

test('clicking away from every plotted line clears the selected indicator', async ({ page }) => {
  await openTreeWithSavedSma(page);
  await selectSmaRow(page);
  const empty = await emptyPanePoint(page);

  await page.mouse.click(empty.x, empty.y);

  await expectNoSelectedIndicator(page);
});

test('clicking a drawing keeps the drawing selected, even where a plot line crosses it', async ({ page }) => {
  await openTreeWithSmaAndDrawing(page, SAVED_SMA_OF_ONE);
  const crossing = await plotLinePoint(page, SMA_INSTANCE_ID, CLICKED_PLOT_POINT);

  await page.mouse.click(crossing.x, crossing.y);

  await expect.poll(async () => (await selectedDrawing(page))?.drawingId).toBe(SELECTED_DRAWING_ID);
  expect(await selectedIndicatorId(page)).toBeNull();
  await expect(indicatorRows(page)).not.toHaveAttribute('data-selected', 'true');
});
