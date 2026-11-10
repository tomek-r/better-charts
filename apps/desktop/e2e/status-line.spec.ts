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

/** The left edge and width of a value on screen, so two values' gaps compare. */
type ValueBox = {
  readonly x: number;
  readonly width: number;
};

/** Measures every value of a values locator in order. */
async function valueBoxes(values: Locator): Promise<ValueBox[]> {
  const valueCount = await values.count();
  const boxes: ValueBox[] = [];
  for (let index = 0; index < valueCount; index += 1) {
    const box = await values.nth(index).boundingBox();
    if (box === null) {
      throw new Error('value not laid out');
    }
    boxes.push({ x: box.x, width: box.width });
  }
  return boxes;
}

/** Asserts that adjacent values leave at least the expected gap between them. */
function expectGapBetweenAdjacentValues(boxes: readonly ValueBox[]): void {
  let previous: ValueBox | undefined;
  for (const box of boxes) {
    if (previous !== undefined) {
      expect(box.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(VALUE_GAP_PX - 1);
    }
    previous = box;
  }
}

test('the bar change reads in the price digits with the percent of its reference', () => {
  expect(formatPriceChange(1.0852, 1.085, 4)).toBe('+0.0002 (+0.02%)');
  expect(formatPriceChange(99, 100, 2)).toBe('\u22121.00 (\u22121.00%)');
});

test('a bar change against no reference shows the amount alone', () => {
  expect(formatPriceChange(0.5, 0, 2)).toBe('+0.50');
});

test('the volume shortens to two decimals once it reaches a thousand', () => {
  expect(formatVolume(999)).toBe('999');
  expect(formatVolume(1_234)).toBe('1.23K');
  expect(formatVolume(4_500_000)).toBe('4.50M');
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

test('the default volume value takes the rising body colour of the prices', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const volumeValue = page.locator('.chart-legend-volume');
  await expect(volumeValue).toHaveCount(1);
  await expect(volumeValue).toHaveCSS('color', RISING_BODY_COLOR);
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

test('adjacent indicator values keep a gap between them', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const search = await openIndicators(page);
  await search.fill(BOLLINGER_SEARCH);
  await listRows(page).first().click();
  await expect(indicatorsDialog(page)).toBeHidden();
  const values = indicatorValues(page);
  await expect(values).toHaveCount(3);
  expectGapBetweenAdjacentValues(await valueBoxes(values));
  expectNoErrors(collected);
});
