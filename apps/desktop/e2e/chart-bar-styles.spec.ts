import { expect, test, type Page } from '@playwright/test';
import { chartScopeKey, expectNoErrors, gotoWithStub, windowCandles } from './helpers/tauriStub';

/**
 * The bars the chart draws once its saved bar style is not candles: a second series draws every other
 * style, while the anchor candle series stays in place to carry the primitives and the price fit.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The palette pair the anchor's candles are drawn in. */
const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#f7525f';
/** What the anchor paints once another series draws the bars. */
const HIDDEN_COLOR = 'transparent';
/** A fill colour no default draws, so an area chart drawn with it cannot be mistaken for a default one. */
const SEEDED_FILL_TOP = '#123456';

/** Waits for the stub's ten bars, so both series have points whose values can be read. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** The bar style series as the hook shows it. */
async function barStyle(page: Page) {
  return page.evaluate(() => window.__chartTest!.barStyle());
}

/** Waits for the bar style series to be the one the library draws `seriesType` with. */
async function waitForSeriesType(page: Page, seriesType: string): Promise<void> {
  await expect.poll(async () => (await barStyle(page)).seriesType).toBe(seriesType);
}

/** The level the baseline test saves, and how closely the drawn base price has to follow its range. */
const BASELINE_LEVEL_PERCENT = 25;
const BASE_PRICE_TOLERANCE = 1e-9;

/** The prices of one bar, which the Heikin Ashi formula reads and the drawn candle points carry. */
interface BarPrices {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** The Heikin Ashi prices the chart is expected to draw, worked out from the raw bars it holds. */
function heikinAshiPrices(bars: readonly BarPrices[]): BarPrices[] {
  const heikinAshi: BarPrices[] = [];
  for (const bar of bars) {
    const previous = heikinAshi[heikinAshi.length - 1];
    const open = previous === undefined ? (bar.open + bar.close) / 2 : (previous.open + previous.close) / 2;
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    heikinAshi.push({ open, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), close });
  }
  return heikinAshi;
}

/** The stub's window of bars with every bar 0.001 above the one before it. */
function risingCandles(count: number) {
  return windowCandles(count).map((candle, index) => {
    const lift = (price: string) => (Number(price) + index * 0.001).toFixed(4);
    return {
      ...candle,
      open: lift(candle.open),
      high: lift(candle.high),
      low: lift(candle.low),
      close: lift(candle.close),
    };
  });
}

/** How far the drawn base price sits from the saved share of the price scale's visible range. */
async function basePriceGap(page: Page, levelPercent: number): Promise<number> {
  return page.evaluate((percent) => {
    const { range } = window.__chartTest!.priceScale();
    const { baseValue } = window.__chartTest!.barStyle().options;
    if (range === null || typeof baseValue !== 'object' || baseValue === null) {
      return Number.POSITIVE_INFINITY;
    }
    const { price } = baseValue as { price?: number };
    if (typeof price !== 'number') {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(price - (range.from + ((range.to - range.from) * percent) / 100));
  }, levelPercent);
}

test('a default chart draws its candles on the anchor series and nothing else', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const state = await barStyle(page);
  expect(state.style).toBe('candles');
  expect(state.seriesType).toBeNull();
  expect(state.points).toEqual([]);

  const colors = await page.evaluate(() => window.__chartTest!.candles().colors);
  expect(colors.upColor).toBe(UP_COLOR);
  expect(colors.downColor).toBe(DOWN_COLOR);
  expect(colors.borderVisible).toBe(false);
  expect(colors.wickVisible).toBe(true);
  expectNoErrors(collected);
});

test('a chart saved on the line style plots every close on a line and empties the anchor', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'line' } } });
  await openChart(page);
  await waitForSeriesType(page, 'Line');

  const drawn = await page.evaluate(() => ({
    closes: window.__chartTest!.data().map((bar) => bar.close),
    values: window.__chartTest!.barStyle().points.map((point) => point.value),
    colors: window.__chartTest!.candles().colors,
  }));

  expect(drawn.values).toEqual(drawn.closes);
  expect(drawn.colors.upColor).toBe(HIDDEN_COLOR);
  expect(drawn.colors.downColor).toBe(HIDDEN_COLOR);
  expect(drawn.colors.borderVisible).toBe(false);
  expect(drawn.colors.wickVisible).toBe(false);
  expectNoErrors(collected);
});

test('a chart saved on the step line style draws the line in steps', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'stepLine' } } });
  await openChart(page);
  await waitForSeriesType(page, 'Line');

  const state = await barStyle(page);
  expect(state.style).toBe('stepLine');
  // LineType.WithSteps, which the library numbers 1.
  expect(state.options.lineType).toBe(1);
  expectNoErrors(collected);
});

test('the bars style saved with HLC bars leaves the open out', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'bars', barStyles: { bars: { hlcBars: true } } } },
  });
  await openChart(page);
  await waitForSeriesType(page, 'Bar');

  expect((await barStyle(page)).options.openVisible).toBe(false);
  expectNoErrors(collected);
});

test('a chart saved on the columns style draws a histogram', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'columns' } } });
  await openChart(page);
  await waitForSeriesType(page, 'Histogram');

  expect((await barStyle(page)).style).toBe('columns');
  expectNoErrors(collected);
});

test('the area style fills in the colours the chart was saved with', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'area', barStyles: { area: { fillTop: SEEDED_FILL_TOP } } } },
  });
  await openChart(page);
  await waitForSeriesType(page, 'Area');

  expect((await barStyle(page)).options.topColor).toBe(SEEDED_FILL_TOP);
  expectNoErrors(collected);
});

test('the heikin ashi style draws the candle series on the heikin ashi prices', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'heikinAshi' } },
  });
  await openChart(page);
  await waitForSeriesType(page, 'Candlestick');

  const drawn = await page.evaluate(() => ({
    bars: window.__chartTest!.data(),
    points: window.__chartTest!.barStyle().points,
    colors: window.__chartTest!.candles().colors,
  }));
  const expected = heikinAshiPrices(drawn.bars);

  expect(drawn.points).toHaveLength(expected.length);
  for (const [index, heikinAshiBar] of expected.entries()) {
    const point = drawn.points[index];
    expect(point?.open).toBeCloseTo(heikinAshiBar.open, 10);
    expect(point?.high).toBeCloseTo(heikinAshiBar.high, 10);
    expect(point?.low).toBeCloseTo(heikinAshiBar.low, 10);
    expect(point?.close).toBeCloseTo(heikinAshiBar.close, 10);
  }
  expect(drawn.colors.upColor).toBe(HIDDEN_COLOR);
  expect(drawn.colors.downColor).toBe(HIDDEN_COLOR);
  expectNoErrors(collected);
});

test('the baseline turns its fill at the saved share of the visible price range', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    // Each bar sits higher than the one before, so a narrower window of bars spans another price range.
    historyByTimeframe: { M5: risingCandles(STUB_BAR_COUNT) },
    chartSettingOverrides: {
      [EURUSD_CHART]: { barStyle: 'baseline', barStyles: { baseline: { baseLevel: BASELINE_LEVEL_PERCENT } } },
    },
  });
  await openChart(page);
  await waitForSeriesType(page, 'Baseline');

  await expect.poll(() => basePriceGap(page, BASELINE_LEVEL_PERCENT)).toBeLessThan(BASE_PRICE_TOLERANCE);

  // The price scale holds its fitted range by default; auto scale makes it follow the visible bars.
  const host = await page.evaluate(() => {
    const rect = document.querySelector('.chart-host')!.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(host.left + host.width - 20, host.top + host.height / 2);
  await page.getByRole('button', { name: /^Auto scale/ }).click();
  await expect.poll(() => page.evaluate(() => window.__chartTest!.priceScale().autoScale)).toBe(true);
  await expect.poll(() => basePriceGap(page, BASELINE_LEVEL_PERCENT)).toBeLessThan(BASE_PRICE_TOLERANCE);

  const rangeBefore = await page.evaluate(() => window.__chartTest!.priceScale().range);
  // Scrolls the window onto another span of bars: another visible range, so another base price.
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 2, to: 6 }));

  await expect.poll(() => page.evaluate(() => window.__chartTest!.priceScale().range)).not.toEqual(rangeBefore);
  await expect.poll(() => basePriceGap(page, BASELINE_LEVEL_PERCENT)).toBeLessThan(BASE_PRICE_TOLERANCE);
  expectNoErrors(collected);
});
