import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  PRICE_PANE_GROUP,
  SMA_9_CLOSE,
  openObjectTree,
  paneGroup,
  paneGroupNames,
  paneIndicatorRows,
} from './helpers/indicatorObjectTree';
import { paintsOverBars, savedIndicatorOrder, seriesOrderOf } from './helpers/indicatorOrder';
import { openChart } from './helpers/openChart';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { readSavedIndicators, type SavedIndicator } from '../src/features/chart/chartSettings/savedIndicators';

/**
 * The price bars' place among the rows of the price pane, which decides what the chart paints over the candles:
 * the bars row crosses into the price-pane indicator rows by a drag or by Alt+Arrow, so an indicator listed over
 * the bars row paints over the candles and one listed under it paints under them. The side of the bars is saved
 * with the indicators, so a reload paints the same way, and an indicator of a pane of its own never moves.
 */

/** The moving averages these cases seed, and the instance ids their rows carry. */
const SMA_INSTANCE_ID = 'sma-1';
const EMA_INSTANCE_ID = 'ema-1';
const SAVED_SMA_9 = { instanceId: SMA_INSTANCE_ID, definitionId: 'sma', settings: {} };
const SAVED_EMA_9 = { instanceId: EMA_INSTANCE_ID, definitionId: 'ema', settings: {} };

/** The same moving average saved under the price bars: what a chart that moved the bars over it holds. */
const SAVED_SMA_UNDER_BARS = { ...SAVED_SMA_9, belowBars: true };

/** The second price-pane indicator, under the bars once one drag of the bars row passes it. */
const SAVED_EMA_UNDER_BARS = { ...SAVED_EMA_9, belowBars: true };

/** The indicator with a pane of its own, which no move of the bars row may take out of its group. */
const SAVED_RSI_14 = { instanceId: 'rsi-1', definitionId: 'rsi', settings: {} };
const SECOND_PANE_GROUP = 'Pane 2';

/** The key the bars row reads as in the row list, where a drawing carries its id and an indicator its instance id. */
const BARS_ROW_KEY = 'bars';

/** The point inside a row that drops above it, and the one that drops below it: a row is 36 CSS pixels tall. */
const ABOVE_ROW = { x: 20, y: 2 };
const BELOW_ROW = { x: 20, y: 30 };

/** The price pane's rows, topmost first: an indicator by its instance id, a drawing by its id, the bars as 'bars'. */
function pricePaneRowKeys(page: Page): Promise<Array<string | null>> {
  return paneGroup(page, PRICE_PANE_GROUP)
    .locator('li.object-tree-row')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const instanceId = row.getAttribute('data-instance-id');
        return instanceId ?? row.getAttribute('data-drawing-id') ?? row.getAttribute('data-layer');
      }),
    );
}

/** The row of the price bars, whose place among the price pane's rows decides where the candles paint. */
function barsRow(page: Page): Locator {
  return paneGroup(page, PRICE_PANE_GROUP).locator('[data-layer="bars"]');
}

/** The name button of the price bars row, which the arrow keys land on. */
function barsName(page: Page): Locator {
  return barsRow(page).locator('.object-tree-row-name');
}

/** The row of one price-pane indicator. */
function indicatorRow(page: Page, instanceId: string): Locator {
  return paneGroup(page, PRICE_PANE_GROUP).locator(`[data-instance-id="${instanceId}"]`);
}

/** The name button of one price-pane indicator row. */
function indicatorRowName(page: Page, instanceId: string, name: string): Locator {
  return indicatorRow(page, instanceId).getByRole('button', { name, exact: true });
}

/** Boots the app with the given indicators saved and opens the object tree drawer. */
async function openTreeWith(page: Page, savedIndicators: unknown[]): Promise<void> {
  await openWithSavedIndicators(page, savedIndicators);
  await openObjectTree(page);
}

/** The indicators the chart's settings document holds, as the app saved them last. */
async function savedIndicators(page: Page): Promise<readonly SavedIndicator[] | undefined> {
  return readSavedIndicators(await latestSavedIndicators(page));
}

test('an indicator saved under the price bars lists under the bars row and paints under the candles', async ({
  page,
}) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS]);

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([BARS_ROW_KEY, SMA_INSTANCE_ID]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(false);
  expect(await seriesOrderOf(page, SMA_INSTANCE_ID)).not.toBeNull();
});

test('dragging the bars row under an indicator row paints it over the candles, and a reload keeps it', async ({
  page,
}) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(false);

  await barsRow(page).dragTo(indicatorRow(page, SMA_INSTANCE_ID), { targetPosition: BELOW_ROW });

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
  // The side of the bars is saved with the indicators, so an indicator over the candles names no flag.
  await expect.poll(() => savedIndicators(page)).toEqual([SAVED_SMA_9]);

  await page.reload();
  await openChart(page);
  await openObjectTree(page);
  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
});

test('dragging an indicator row over the bars row paints it over the candles', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS]);
  await expect.poll(() => pricePaneRowKeys(page)).toEqual([BARS_ROW_KEY, SMA_INSTANCE_ID]);

  await indicatorRow(page, SMA_INSTANCE_ID).dragTo(barsRow(page), { targetPosition: ABOVE_ROW });

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
  await expect.poll(() => savedIndicators(page)).toEqual([SAVED_SMA_9]);
});

test('dragging the bars row under an indicator row paints the rows under it under the candles', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_9, SAVED_EMA_9]);
  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, EMA_INSTANCE_ID, BARS_ROW_KEY]);

  await barsRow(page).dragTo(indicatorRow(page, SMA_INSTANCE_ID), { targetPosition: BELOW_ROW });

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY, EMA_INSTANCE_ID]);
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
  await expect.poll(() => paintsOverBars(page, EMA_INSTANCE_ID)).toBe(false);
  // The two indicators keep their order among themselves; only the side of the bars changed.
  await expect.poll(() => savedIndicatorOrder(page)).toEqual([SMA_INSTANCE_ID, EMA_INSTANCE_ID]);
  await expect.poll(() => savedIndicators(page)).toEqual([SAVED_SMA_9, SAVED_EMA_UNDER_BARS]);
});

test('Alt+ArrowDown on the bars row moves it past an indicator row and keeps the focus on it', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS]);
  await expect.poll(() => pricePaneRowKeys(page)).toEqual([BARS_ROW_KEY, SMA_INSTANCE_ID]);
  const bars = barsName(page);

  await bars.focus();
  await page.keyboard.press('Alt+ArrowDown');

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY]);
  await expect(bars).toBeFocused();
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
});

test('Alt+ArrowUp on an indicator row under the bars row paints it over the candles', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS]);
  await expect.poll(() => pricePaneRowKeys(page)).toEqual([BARS_ROW_KEY, SMA_INSTANCE_ID]);
  const name = indicatorRowName(page, SMA_INSTANCE_ID, SMA_9_CLOSE);

  await name.focus();
  await page.keyboard.press('Alt+ArrowUp');

  await expect.poll(() => pricePaneRowKeys(page)).toEqual([SMA_INSTANCE_ID, BARS_ROW_KEY]);
  await expect(name).toBeFocused();
  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
});

test('crossing the bars row leaves an indicator of a pane of its own in its group', async ({ page }) => {
  await openTreeWith(page, [SAVED_SMA_UNDER_BARS, SAVED_RSI_14]);
  await expect.poll(() => paneGroupNames(page)).toEqual([PRICE_PANE_GROUP, SECOND_PANE_GROUP]);

  await barsRow(page).dragTo(indicatorRow(page, SMA_INSTANCE_ID), { targetPosition: BELOW_ROW });

  await expect.poll(() => paintsOverBars(page, SMA_INSTANCE_ID)).toBe(true);
  expect(await paneGroupNames(page)).toEqual([PRICE_PANE_GROUP, SECOND_PANE_GROUP]);
  await expect(paneIndicatorRows(paneGroup(page, SECOND_PANE_GROUP))).toHaveCount(1);
  await expect.poll(() => savedIndicators(page)).toEqual([SAVED_SMA_9, SAVED_RSI_14]);
});
