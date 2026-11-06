import { expect, test, type Locator, type Page } from '@playwright/test';

import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { DEFAULT_CANDLE_APPEARANCE } from '../src/features/chart/engine/bars/candleAppearance';
import type {
  BarsAppearance,
  CandleStyleAppearance,
  ColumnsAppearance,
  HighLowAppearance,
  HollowCandlesAppearance,
  LineStyleAppearance,
} from '../src/features/chart/engine/barStyle/barStyleAppearance';
import { barBodyColor } from '../src/features/chart/engine/barStyle/barBodyColor';
import { HeikinAshiChain } from '../src/features/chart/engine/barStyle/heikinAshi';
import { legendBarIndex } from '../src/features/chart/engine/legend/legendBarIndex';
import { waitTwoAnimationFrames } from './helpers/animationFrames';
import { CHART_HOST_SELECTOR } from './helpers/chartHost';
import { chartScopeKey, gotoWithStub } from './helpers/tauriStub';

const STUB_BAR_COUNT = 10;
const LEGEND_VALUE_COUNT = 4;
/** The default candle body colours the stub's chart draws with. */
const RISING_BODY_COLOR = 'rgb(38, 166, 154)';
const SECONDS_TO_MS = 1000;
const CANDLE_LEGEND_LABEL = 'Candle OHLC';
/** Bar 0 in the pane with empty space right of the last bar, so the pointer meets one bar at a time. */
const HOVER_RANGE = { from: -2, to: 14 };
/** Two bar spacings right of the last stub bar: chart space with no bar under the pointer. */
const PAST_LAST_BAR_OFFSET = STUB_BAR_COUNT + 1;

/** A bar with a body; its range always holds the two prices the test sets. */
function barOf(open: number, close: number, time = 0): RenderBar {
  return { time, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 0 };
}

const RISING = barOf(1, 2, 0);
const FALLING = barOf(2, 1, 1);
/** Closes above the bar before it but below its own open, so the two direction rules disagree. */
const BELOW_ITS_OPEN = barOf(3, 2.5, 1);

const BAR_COLORS = { up: '#00aa00', down: '#aa0000' };
const BARS: BarsAppearance = {
  style: 'bars',
  colorByPreviousClose: false,
  colors: BAR_COLORS,
  thinBars: false,
  hlcBars: false,
};

/** The decimals the OHLC legend writes its close price with, read from the line's own text. */
async function legendDecimals(page: Page): Promise<number> {
  const written = /C \d+\.(\d+)/.exec((await page.getByLabel(CANDLE_LEGEND_LABEL).textContent()) ?? '');
  if (written === null) {
    throw new Error('The OHLC legend writes no close price.');
  }
  return written[1]!.length;
}

/**
 * The legend's close text for a bar's `close`, so a test names the price it expects without
 * formatting it again; throws rather than assert on a price the bar does not have.
 */
function closeText(close: number | undefined, decimals: number): string {
  if (close === undefined) {
    throw new Error('The bar the legend should read has no close price.');
  }
  return `C ${close.toFixed(decimals)}`;
}

/**
 * Points the pointer `spacings` bar spacings right of bar 0, at half the host's height, and returns the
 * stub bars' closes so a test can name the bar it is over.
 */
async function hoverFromBar0(page: Page, spacings: number): Promise<readonly number[]> {
  await page.evaluate((range) => window.__chartTest!.scrollToRange(range), HOVER_RANGE);
  await waitTwoAnimationFrames(page);
  const closes = await page.evaluate(() => window.__chartTest!.data().map((bar) => bar.close));
  const xs = await page.evaluate((secondsToMs) => {
    const chart = window.__chartTest!;
    return chart.data().map((bar) => chart.timeToX(bar.time * secondsToMs));
  }, SECONDS_TO_MS);
  const host = await page.locator(CHART_HOST_SELECTOR).boundingBox();
  if (host === null) {
    throw new Error('The chart host is not laid out.');
  }
  const spacing = xs[1]! - xs[0]!;
  await page.mouse.move(host.x + xs[0]! + spacings * spacing, host.y + host.height / 2);
  return closes;
}

/** Opens the stub chart and waits until it has drawn every stub bar. */
async function openStubChart(page: Page, options?: Parameters<typeof gotoWithStub>[1]): Promise<void> {
  await gotoWithStub(page, options);
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** Opens the stub chart and returns its OHLC legend with the decimals that legend writes prices with. */
async function openHoverLegend(page: Page): Promise<{ legend: Locator; decimals: number }> {
  await openStubChart(page);
  const legend = page.getByLabel(CANDLE_LEGEND_LABEL);
  return { legend, decimals: await legendDecimals(page) };
}

/**
 * Opens the hover legend, points the pointer at bar 0 and returns that legend, the decimals it writes
 * prices with and the stub bars' closes, so a test can name the bar the legend reads.
 */
async function hoverFirstBar(page: Page): Promise<{ legend: Locator; decimals: number; closes: readonly number[] }> {
  const { legend, decimals } = await openHoverLegend(page);
  const closes = await hoverFromBar0(page, 0);
  return { legend, decimals, closes };
}

test('a candle takes the body colour of the direction it closed in', () => {
  const candles: CandleStyleAppearance = { style: 'candles', candles: DEFAULT_CANDLE_APPEARANCE };

  expect(barBodyColor(candles, RISING, undefined)).toBe(DEFAULT_CANDLE_APPEARANCE.body.up);
  expect(barBodyColor(candles, FALLING, undefined)).toBe(DEFAULT_CANDLE_APPEARANCE.body.down);
});

test('a candle set to colour by the previous close reads the bar before it', () => {
  const candles: CandleStyleAppearance = {
    style: 'candles',
    candles: { ...DEFAULT_CANDLE_APPEARANCE, colorByPreviousClose: true },
  };

  expect(barBodyColor(candles, BELOW_ITS_OPEN, RISING)).toBe(DEFAULT_CANDLE_APPEARANCE.body.up);
  expect(barBodyColor(candles, BELOW_ITS_OPEN, undefined)).toBe(DEFAULT_CANDLE_APPEARANCE.body.down);
});

test('a hollow candle colours by the previous close whoever asked', () => {
  const hollow: HollowCandlesAppearance = { style: 'hollowCandles', candles: DEFAULT_CANDLE_APPEARANCE };

  expect(barBodyColor(hollow, BELOW_ITS_OPEN, RISING)).toBe(DEFAULT_CANDLE_APPEARANCE.body.up);
  expect(barBodyColor(hollow, BELOW_ITS_OPEN, undefined)).toBe(DEFAULT_CANDLE_APPEARANCE.body.down);
});

test('bars and columns take their up and down colours', () => {
  const columns: ColumnsAppearance = { style: 'columns', colorByPreviousClose: false, colors: BAR_COLORS };

  expect(barBodyColor(BARS, RISING, undefined)).toBe(BAR_COLORS.up);
  expect(barBodyColor(BARS, FALLING, undefined)).toBe(BAR_COLORS.down);
  expect(barBodyColor(columns, RISING, undefined)).toBe(BAR_COLORS.up);
  expect(barBodyColor(columns, FALLING, undefined)).toBe(BAR_COLORS.down);
});

test('a style with no up and down colours leaves the legend its label colour', () => {
  const line: LineStyleAppearance = { style: 'line', priceSource: 'close', color: '#123456', lineWidth: 1 };
  const highLow: HighLowAppearance = {
    style: 'highLow',
    body: { visible: true, color: '#123456' },
    borders: { visible: true, color: '#123456' },
    labels: { visible: true, color: '#123456' },
  };

  expect(barBodyColor(line, RISING, undefined)).toBeNull();
  expect(barBodyColor(highLow, FALLING, undefined)).toBeNull();
});

test('a raw bar closing below its open still draws a rising Heikin Ashi bar', () => {
  const fallingRawBar: RenderBar = { time: 0, open: 20, high: 30, low: 8, close: 10, volume: 0 };
  const chain = new HeikinAshiChain();

  chain.rebuild([fallingRawBar]);

  // The close averages the four prices and the first open is the middle of the raw body.
  expect(chain.at(0).bar).toMatchObject({ open: 15, close: 17 });
});

test('the Heikin Ashi chain reads a bar and the one before it by index', () => {
  const chain = new HeikinAshiChain();
  chain.rebuild([barOf(1, 2, 0), barOf(2, 3, 300)]);

  expect(chain.at(1).previous).toEqual(chain.at(0).bar);
});

test('the legend index rounds a pointer over a bar and falls back to the last bar elsewhere', () => {
  expect(legendBarIndex(2, STUB_BAR_COUNT)).toBe(2);
  expect(legendBarIndex(2.4, STUB_BAR_COUNT)).toBe(2);
  expect(legendBarIndex(null, STUB_BAR_COUNT)).toBe(STUB_BAR_COUNT - 1);
  expect(legendBarIndex(-1, STUB_BAR_COUNT)).toBe(STUB_BAR_COUNT - 1);
  expect(legendBarIndex(STUB_BAR_COUNT, STUB_BAR_COUNT)).toBe(STUB_BAR_COUNT - 1);
  expect(legendBarIndex(null, 0)).toBe(-1);
});

test('the OHLC values take the body colour of the rising last bar', async ({ page }) => {
  await openStubChart(page);

  const values = page.locator('.chart-legend-value');
  await expect(values).toHaveCount(LEGEND_VALUE_COUNT);
  for (const value of await values.all()) {
    await expect(value).toHaveCSS('color', RISING_BODY_COLOR);
  }
  await expect(page.locator('.chart-legend')).not.toHaveCSS('color', RISING_BODY_COLOR);
});

test('a bar style with no body colours leaves the values in the label colour', async ({ page }) => {
  await openStubChart(page, {
    chartSettingOverrides: { [chartScopeKey('50123456@Broker-Demo', 'EURUSD')]: { barStyle: 'line' } },
  });

  const labelColor = await page.locator('.chart-legend').evaluate((legend) => getComputedStyle(legend).color);
  const values = page.locator('.chart-legend-value');
  await expect(values).toHaveCount(LEGEND_VALUE_COUNT);
  for (const value of await values.all()) {
    await expect(value).toHaveCSS('color', labelColor);
  }
});

test('the OHLC values read the bar under the pointer in its body colour', async ({ page }) => {
  const { legend, decimals, closes } = await hoverFirstBar(page);
  const values = page.locator('.chart-legend-value');

  await expect(legend).toContainText(closeText(closes[0], decimals));
  const colors = await values.evaluateAll((shown) => shown.map((value) => getComputedStyle(value).color));
  expect(colors).toEqual(Array.from({ length: LEGEND_VALUE_COUNT }, () => RISING_BODY_COLOR));
});

test('the OHLC values go back to the last bar when the pointer leaves the chart', async ({ page }) => {
  const { legend, decimals, closes } = await hoverFirstBar(page);

  await expect(legend).toContainText(closeText(closes[0], decimals));

  await page.mouse.move(0, 0);

  await expect(legend).toContainText(closeText(closes[closes.length - 1], decimals));
});

test('the OHLC values keep the last bar while the pointer is over no bar', async ({ page }) => {
  const { legend, decimals } = await openHoverLegend(page);

  const closes = await hoverFromBar0(page, PAST_LAST_BAR_OFFSET);

  await expect(legend).toContainText(closeText(closes[closes.length - 1], decimals));
});
