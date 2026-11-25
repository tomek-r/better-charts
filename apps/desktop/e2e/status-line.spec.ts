import { expect, test, type Locator, type Page } from '@playwright/test';
import { openChartSettingsTab } from './helpers/chartSettingsDialog';
import { attachSma, indicatorsDialog, listRows, openIndicators } from './helpers/indicatorsDialog';
import { openChart } from './helpers/openChart';
import { chartScopeKey, expectNoErrors, gotoWithStub, holdIdleCallbacks, windowCandles } from './helpers/tauriStub';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import {
  barChangeReference,
  formatPriceChange,
  formatVolume,
  previousDayClose,
} from '../src/features/chart/engine/legend/legendValues';
import { statusLineTitle } from '../src/features/chart/engine/legend/statusLineAppearance';

/**
 * The Status line tab and the line it draws: the OHLC readout's title, prices, bar change, volume and last
 * day change, and the indicator legend rows' titles, inputs and values.
 */

const ACCOUNT_KEY = '50123456@Broker-Demo';
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
const SYMBOL = 'EURUSD';
const DESCRIPTION = 'Euro vs US Dollar';
const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;
const WEEK_SECONDS = 604_800;
const FIRST_DAY = 10 * DAY_SECONDS;
const SECOND_DAY = 11 * DAY_SECONDS;
const STUB_VOLUME = 120;
const OHLC_VALUE_COUNT = 4;
const RISING_BODY_COLOR = 'rgb(38, 166, 154)';
const SAME_DAY_BARS = 20;
const PREVIOUS_DAY_PAGE_BARS = 300;
const VALUE_GAP_PX = 6;
const BOLLINGER_SEARCH = 'bollinger';
/** The background a test configures for the status line, and the colour the browser then paints it in. */
const BACKGROUND_HEX = '#123456';
const BACKGROUND_RGB = 'rgb(18, 52, 86)';
/** Two price-pane indicators, so the legend has a row under the OHLC line and one under that. */
const SMA_ENTRY = { instanceId: 'sma-1', definitionId: 'sma', settings: {} };
const EMA_ENTRY = { instanceId: 'ema-1', definitionId: 'ema', settings: {} };
/** How far two legend rows may miss each other's edge and still be drawn on each other. */
const TOUCHING_TOLERANCE_PX = 1;

/** A bar of the stub's shape, flat and with one volume, so only the field a test reads varies. */
function barOf(time: number, close: number): RenderBar {
  return { time, open: close, high: close, low: close, close, volume: STUB_VOLUME };
}

/** Two bars on the first broker day, then two on the second. */
function barsAcrossDays(): RenderBar[] {
  return [
    barOf(FIRST_DAY, 1),
    barOf(FIRST_DAY + HOUR_SECONDS, 2),
    barOf(SECOND_DAY, 3),
    barOf(SECOND_DAY + HOUR_SECONDS, 4),
  ];
}

/** Opens the chart with the Status line overrides a test needs, and returns the page's console errors. */
async function openWithStatusLine(page: Page, statusLine: Record<string, unknown>) {
  const collected = await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { statusLine } } });
  await openChart(page);
  return collected;
}

function chartLegend(page: Page): Locator {
  return page.locator('.chart-legend');
}

function changeSpans(page: Page): Locator {
  return page.locator('.chart-legend-change');
}

function indicatorTitle(page: Page): Locator {
  return page.locator('.chart-indicator-legend-title');
}

function indicatorInputs(page: Page): Locator {
  return page.locator('.chart-indicator-legend-inputs');
}

function indicatorValues(page: Page): Locator {
  return page.locator('.chart-indicator-legend-value');
}

function dialogCheckbox(dialog: Locator, name: string): Locator {
  return dialog.getByRole('checkbox', { name, exact: true });
}

/** Opens the chart and its settings dialog on the Status line tab. */
async function openStatusLineTab(page: Page): Promise<Locator> {
  await gotoWithStub(page);
  await openChart(page);
  return openChartSettingsTab(page, 'Status line');
}

/** The left edge and width of a legend piece on screen, so the gaps between two pieces compare. */
type ValueBox = {
  readonly x: number;
  readonly width: number;
};

/** Measures the given legend pieces in order. */
async function valueBoxes(pieces: readonly Locator[]): Promise<ValueBox[]> {
  const boxes: ValueBox[] = [];
  for (const piece of pieces) {
    const box = await piece.boundingBox();
    if (box === null) {
      throw new Error('legend piece not laid out');
    }
    boxes.push({ x: box.x, width: box.width });
  }
  return boxes;
}

/** Asserts that every neighbouring pair leaves the same gap between them, within a pixel of rounding. */
function expectEqualGaps(boxes: readonly ValueBox[]): void {
  let previous: ValueBox | undefined;
  for (const box of boxes) {
    if (previous !== undefined) {
      const gap = box.x - (previous.x + previous.width);
      expect(Math.abs(gap - VALUE_GAP_PX)).toBeLessThanOrEqual(1);
    }
    previous = box;
  }
}

/** A legend row as it is painted: its top and bottom edges and the background it shows between them. */
interface PaintedRow {
  readonly top: number;
  readonly bottom: number;
  readonly background: string;
}

/** The rows of the legend as they stack from the top, with the background each one paints. */
function paintedRows(page: Page): Promise<PaintedRow[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.chart-legend, .chart-indicator-legend-row'));
    return rows
      .map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, background: getComputedStyle(row).backgroundColor };
      })
      .sort((one, other) => one.top - other.top);
  });
}

test('the bar change reads in the price digits with the percent of its reference', () => {
  expect(formatPriceChange(1.0852, 1.085, 4)).toBe('+0.0002 (+0.02%)');
  expect(formatPriceChange(99, 100, 2)).toBe('\u22121.00 (\u22121.00%)');
});

test('a bar change against no reference shows the amount alone', () => {
  expect(formatPriceChange(0.5, 0, 2)).toBe('+0.50');
});

test('the volume shortens to at most two decimals and a spaced unit once it reaches a thousand', () => {
  expect(formatVolume(999)).toBe('999');
  expect(formatVolume(1_234)).toBe('1.23 K');
  expect(formatVolume(4_500_000)).toBe('4.5 M');
});

test('the bar change reference is the previous close, or the bar own open when it is the first', () => {
  const bar = barOf(SECOND_DAY, 2);
  expect(barChangeReference(bar, barOf(FIRST_DAY, 1.5))).toBe(1.5);
  expect(barChangeReference(bar, undefined)).toBe(bar.open);
});

test('the last day close is the newest close of a broker day before the last bar', () => {
  expect(previousDayClose(barsAcrossDays(), HOUR_SECONDS)).toBe(2);
});

test('the last day close is missing while no earlier day is loaded', () => {
  expect(previousDayClose([barOf(SECOND_DAY, 3)], HOUR_SECONDS)).toBeNull();
  expect(previousDayClose([], HOUR_SECONDS)).toBeNull();
});

test('a bar longer than a day has no previous day close, while a daily bar has the day before', () => {
  expect(previousDayClose(barsAcrossDays(), WEEK_SECONDS)).toBeNull();
  expect(previousDayClose([barOf(FIRST_DAY, 1.5), barOf(SECOND_DAY, 2)], DAY_SECONDS)).toBe(1.5);
});

test('the title format chooses between the name, the symbol and both', () => {
  expect(statusLineTitle('name', SYMBOL, DESCRIPTION)).toBe(DESCRIPTION);
  expect(statusLineTitle('symbol', SYMBOL, DESCRIPTION)).toBe(SYMBOL);
  expect(statusLineTitle('symbolAndName', SYMBOL, DESCRIPTION)).toBe(`${SYMBOL} \u00b7 ${DESCRIPTION}`);
  expect(statusLineTitle('name', SYMBOL, undefined)).toBe(SYMBOL);
  expect(statusLineTitle('symbolAndName', SYMBOL, undefined)).toBe(SYMBOL);
});

test('switching the chart values off leaves no price on the OHLC line', async ({ page }) => {
  const collected = await openWithStatusLine(page, { chartValues: false });
  await expect(page.locator('.chart-legend-value')).toHaveCount(0);
  expectNoErrors(collected);
});

test('switching the title off leaves the symbol out of the OHLC line', async ({ page }) => {
  const collected = await openWithStatusLine(page, { title: false });
  await expect(chartLegend(page)).not.toContainText(SYMBOL);
  expectNoErrors(collected);
});

test('switching the market status off hides the dot before the title', async ({ page }) => {
  const collected = await openWithStatusLine(page, { marketStatus: false });
  await expect(page.locator('.chart-market-dot')).toBeHidden();
  expectNoErrors(collected);
});

test('switching the volume off leaves Vol out of the OHLC line', async ({ page }) => {
  const collected = await openWithStatusLine(page, { volume: false });
  await expect(chartLegend(page)).not.toContainText('Vol ');
  expectNoErrors(collected);
});

test('switching both change readouts off leaves no change on the OHLC line', async ({ page }) => {
  const collected = await openWithStatusLine(page, { barChange: false, lastDayChange: false });
  await expect(changeSpans(page)).toHaveCount(0);
  expectNoErrors(collected);
});

test('the default OHLC line reads the volume and a change beside the prices', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await expect(chartLegend(page)).toContainText('Vol ');
  expect(await changeSpans(page).count()).toBeGreaterThanOrEqual(1);
  expectNoErrors(collected);
});

test('the bar change reads after a Bar label, as Vol and Day do', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await expect(chartLegend(page)).toContainText(/Bar [+−]\d/);
  expectNoErrors(collected);
});

test('the default volume value takes the rising body colour of the prices', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const volumeValue = page.locator('.chart-legend-volume');
  await expect(volumeValue).toHaveCount(1);
  await expect(volumeValue).toHaveCSS('color', RISING_BODY_COLOR);
  expectNoErrors(collected);
});

test('the status line background runs on from the OHLC row into the indicator rows', async ({ page }) => {
  const statusLine = { background: { visible: true, color: BACKGROUND_HEX } };
  const indicators = [SMA_ENTRY, EMA_ENTRY];
  const chartOverrides = { [EURUSD_CHART]: { statusLine, indicators } };
  const collected = await gotoWithStub(page, { chartSettingOverrides: chartOverrides });
  await openChart(page);
  // Off the chart, so no row is hovered and every row paints the configured background rather than its own.
  await page.mouse.move(0, 0);
  await expect(page.locator('.chart-indicator-legend-row')).toHaveCount(indicators.length);

  const rows = await paintedRows(page);
  // The OHLC row and the two indicator rows under it, each of them painted in the configured colour.
  expect(rows).toHaveLength(indicators.length + 1);
  for (const row of rows) {
    expect(row.background).toBe(BACKGROUND_RGB);
  }
  // Their boxes meet, so the background is one block down the legend with no chart showing between two rows.
  for (let index = 1; index < rows.length; index += 1) {
    expect(Math.abs(rows[index].top - rows[index - 1].bottom)).toBeLessThanOrEqual(TOUCHING_TOLERANCE_PX);
  }
  expectNoErrors(collected);
});

test('switching the indicator values off leaves the row without values', async ({ page }) => {
  const collected = await openWithStatusLine(page, { indicatorValues: false });
  await attachSma(page);
  await expect(indicatorTitle(page)).toHaveCount(1);
  await expect(indicatorValues(page)).toHaveCount(0);
  expectNoErrors(collected);
});

test('switching the indicator inputs off leaves the title at the indicator name', async ({ page }) => {
  const collected = await openWithStatusLine(page, { indicatorInputs: false });
  await attachSma(page);
  await expect(indicatorTitle(page)).toHaveText('SMA');
  expectNoErrors(collected);
});

test('switching the indicator titles off leaves an empty row title', async ({ page }) => {
  const collected = await openWithStatusLine(page, { indicatorTitles: false });
  await attachSma(page);
  await expect(indicatorTitle(page)).toHaveText('');
  expectNoErrors(collected);
});

test('the Status line tab lists the instrument and indicator rows and no Logo or buy/sell row', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openStatusLineTab(page);

  for (const heading of ['Instrument', 'Indicators']) {
    await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  const rows = [
    'Title',
    'Open market status',
    'Chart values',
    'Bar change values',
    'Volume',
    'Last day change values',
    'Titles',
    'Inputs',
    'Values',
  ];
  for (const name of rows) {
    await expect(dialogCheckbox(dialog, name)).toBeVisible();
  }
  await expect(dialogCheckbox(dialog, 'Logo')).toHaveCount(0);
  await expect(dialogCheckbox(dialog, 'Buy/sell buttons')).toHaveCount(0);
  expectNoErrors(collected);
});

test('unchecking Chart values clears the prices at once, and Cancel brings them back', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const dialog = await openStatusLineTab(page);
  const prices = page.locator('.chart-legend-value');

  await expect(prices).toHaveCount(OHLC_VALUE_COUNT);
  await dialogCheckbox(dialog, 'Chart values').uncheck();
  await expect(prices).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(prices).toHaveCount(OHLC_VALUE_COUNT);
  expectNoErrors(collected);
});

test('the last day change appears once an older page brings in the previous broker day', async ({ page }) => {
  await holdIdleCallbacks(page);
  const todayCandles = windowCandles(SAME_DAY_BARS);
  const collected = await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: SYMBOL, timeframe: 'M5', complete: true, candles: todayCandles },
    },
    historyByTimeframe: { M5: todayCandles },
    olderHistoryPages: 1,
    olderHistoryBars: PREVIOUS_DAY_PAGE_BARS,
  });
  // A window this short leaves space before its oldest bar, so the chart asks for the older page by itself.
  await expect
    .poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0))
    .toBe(SAME_DAY_BARS + PREVIOUS_DAY_PAGE_BARS);
  await expect(chartLegend(page)).toContainText('Day ');
  expectNoErrors(collected);
});

test('the title, the inputs and every indicator value sit the same gap apart', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const search = await openIndicators(page);
  await search.fill(BOLLINGER_SEARCH);
  await listRows(page).first().click();
  await expect(indicatorsDialog(page)).toBeHidden();
  const values = indicatorValues(page);
  await expect(values).toHaveCount(3);
  const pieces = [indicatorTitle(page), indicatorInputs(page), values.nth(0), values.nth(1), values.nth(2)];
  expectEqualGaps(await valueBoxes(pieces));
  expectNoErrors(collected);
});
