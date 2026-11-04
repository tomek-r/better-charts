import { expect, test, type Page } from '@playwright/test';
import { chartScopeKey, expectNoErrors, gotoWithStub } from './helpers/tauriStub';

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
