import { expect, type Locator, type Page } from '@playwright/test';

/** The names the seeded moving average goes by: its legend name, which its object tree row shows, and its dialog. */
export const SMA_9_CLOSE = 'SMA 9 close';
export const SMA_DIALOG_NAME = 'Moving Average Simple settings';

/** The group holding the price pane's rows: the drawings, the bars and the price-pane indicators. */
export const PRICE_PANE_GROUP = 'Price pane';

/** The legend the chart draws under the OHLC line, where a price-pane indicator's row sits. */
const PRICE_PANE_LEGEND_LABEL = 'Indicator legend';

/** One row of a legend, which the chart draws outside React. */
const LEGEND_ROW_SELECTOR = '.chart-indicator-legend-row';

/** The drawer the tree's rows sit in. */
const OBJECT_TREE_DRAWER_SELECTOR = 'aside[aria-label="Object tree"]';

/**
 * The transform a drawer computes once it has stopped sliding in. It slides for 0.2 s, so a row measured
 * before then still sits off its resting place.
 */
const SETTLED_DRAWER_TRANSFORM = 'matrix(1, 0, 0, 1, 0, 0)';

/** Every pane group of the tree, named as the panes of the chart stack them. */
const PANE_GROUP_NAME = /^(?:Price pane|Pane \d+)$/;

/** One pane group of the tree, by the label it carries. */
export function paneGroup(page: Page, name: string): Locator {
  return page.getByRole('group', { name, exact: true });
}

/** The labels of the pane groups, top to bottom. */
export function paneGroupNames(page: Page): Promise<Array<string | null>> {
  return page
    .getByRole('group', { name: PANE_GROUP_NAME })
    .evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-label')));
}

/** One indicator row of the tree, whose place in its group's list is what the pane's order lists. */
const INDICATOR_ROW_SELECTOR = 'li[data-instance-id]';

/** Every indicator row of one pane group: the price pane's sit among its drawings, an own pane's alone in its list. */
export function paneIndicatorRows(group: Locator): Locator {
  return group.locator(INDICATOR_ROW_SELECTOR);
}

/** Every indicator row of the price pane. */
export function indicatorRows(page: Page): Locator {
  return paneIndicatorRows(paneGroup(page, PRICE_PANE_GROUP));
}

/** The settings dialog of the seeded moving average. */
export function smaSettingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: SMA_DIALOG_NAME });
}

/** Every row of the legend under the OHLC line, top to bottom. */
function pricePaneLegendRows(page: Page): Locator {
  return page.getByLabel(PRICE_PANE_LEGEND_LABEL, { exact: true }).locator(LEGEND_ROW_SELECTOR);
}

/** The row the legend under the OHLC line draws for the price-pane indicator these cases seed. */
export function pricePaneLegendRow(page: Page): Locator {
  return pricePaneLegendRows(page).first();
}

/** The row the legend under the OHLC line draws for the indicator named `title`. */
export function legendRowNamed(page: Page, title: string): Locator {
  return pricePaneLegendRows(page).filter({ hasText: title });
}

/** The id the chart reports as its selected indicator, or null while nothing is selected. */
export function selectedIndicatorId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__chartTest?.selectedIndicator() ?? null);
}

/** Waits for the chart to hold no selected indicator and to leave the indicator rows unframed. */
export async function expectNoSelectedIndicator(page: Page): Promise<void> {
  await expect.poll(() => selectedIndicatorId(page)).toBeNull();
  await expect(indicatorRows(page)).not.toHaveAttribute('data-selected', 'true');
}

/**
 * Opens the object tree drawer, whose indicator rows these cases read, and waits for it to stop sliding so a
 * row measured or pressed here is at the place it keeps.
 */
export async function openObjectTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Object tree', exact: true }).click();
  const drawer = page.locator(OBJECT_TREE_DRAWER_SELECTOR);
  await expect(drawer.getByRole('heading', { name: 'Object tree' })).toBeVisible();
  await expect(drawer).toHaveCSS('transform', SETTLED_DRAWER_TRANSFORM);
}

/** Opens the settings dialog of the chart's moving average, through the settings button its row offers on hover. */
export async function openSmaSettingsFromRow(page: Page): Promise<Locator> {
  await openObjectTree(page);
  const row = indicatorRows(page);
  await row.hover();
  await row.getByRole('button', { name: 'Indicator settings', exact: true }).click();
  const dialog = smaSettingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the settings dialog of the seeded moving average by double clicking its row name. */
export async function openSmaSettingsDialog(page: Page): Promise<Locator> {
  await indicatorRows(page).getByRole('button', { name: SMA_9_CLOSE, exact: true }).dblclick();
  const dialog = smaSettingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}
