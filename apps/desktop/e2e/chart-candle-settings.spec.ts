import { expect, test, type Page } from '@playwright/test';
import { chartScopeKey, expectNoErrors, gotoWithStub } from './helpers/tauriStub';

/**
 * The candles the chart draws with its candle settings: the Body, Borders and Wick toggles with their
 * up and down colours, and "Color bars based on previous close". The appearance is one of the chart's
 * settings, so it is the template's until this chart overrides it for the account and symbol it shows.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The palette pair every candle defaults to. */
const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#f7525f';
/** A body override, so a chart drawn with it cannot be mistaken for a default one. */
const SEEDED_UP_COLOR = '#00ff00';
const SEEDED_DOWN_COLOR = '#ff00ff';

/** One bar's colour override next to the closes that decide it. */
interface PointDirection {
  readonly color: string | null;
  /** The previous bar's close, null for the first bar, which has none. */
  readonly previousClose: number | null;
  readonly open: number;
  readonly close: number;
}

/** Waits for the stub's ten bars, so the candle series has points whose colours can be read. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** The candle series' colour options, read back from the series itself. */
async function candleColors(page: Page) {
  return page.evaluate(() => window.__chartTest!.candles().colors);
}

/** The colour of every bar whose point carries one; empty while the bars keep the series colours. */
async function pointColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const points = window.__chartTest!.candles().points;
    return points.flatMap((point) => (point.color === undefined ? [] : [point.color]));
  });
}

/** Each bar's colour override beside the previous close and its own open, read in one go. */
async function pointDirections(page: Page): Promise<PointDirection[]> {
  return page.evaluate(() => {
    const bars = window.__chartTest!.data();
    return window.__chartTest!.candles().points.map((point, index) => ({
      color: point.color ?? null,
      previousClose: index === 0 ? null : bars[index - 1].close,
      open: bars[index].open,
      close: bars[index].close,
    }));
  });
}

test('a default chart keeps the palette colours, no borders and no per-bar colours', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  const colors = await candleColors(page);
  expect(colors.upColor).toBe(UP_COLOR);
  expect(colors.downColor).toBe(DOWN_COLOR);
  expect(colors.borderVisible).toBe(false);
  expect(colors.borderUpColor).toBe(UP_COLOR);
  expect(colors.borderDownColor).toBe(DOWN_COLOR);
  expect(colors.wickVisible).toBe(true);
  expect(colors.wickUpColor).toBe(UP_COLOR);
  expect(colors.wickDownColor).toBe(DOWN_COLOR);
  expect(await pointColors(page)).toEqual([]);
  expectNoErrors(collected);
});

test('a chart whose body colours were overridden draws the bars in them', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: {
        barStyles: { candles: { body: { visible: true, up: SEEDED_UP_COLOR, down: SEEDED_DOWN_COLOR } } },
      },
    },
  });
  await openChart(page);

  await expect.poll(async () => (await candleColors(page)).upColor).toBe(SEEDED_UP_COLOR);
  await expect.poll(async () => (await candleColors(page)).downColor).toBe(SEEDED_DOWN_COLOR);
  expectNoErrors(collected);
});

test('colouring by the previous close gives every bar the direction of the bar before it', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { barStyles: { candles: { colorByPreviousClose: true } } } },
  });
  await openChart(page);

  await expect.poll(async () => (await pointColors(page)).length).toBe(STUB_BAR_COUNT);
  const directions = await pointDirections(page);
  for (const direction of directions) {
    const reference = direction.previousClose ?? direction.open;
    expect(direction.color).toBe(direction.close >= reference ? UP_COLOR : DOWN_COLOR);
  }
  // Both directions occur among the stub's bars, so neither colour is there by accident.
  expect([...new Set(directions.map((direction) => direction.color))].sort()).toEqual([UP_COLOR, DOWN_COLOR]);
  expectNoErrors(collected);
});

test('a chart whose wick was turned off draws no wick', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: { barStyles: { candles: { wick: { visible: false, up: UP_COLOR, down: DOWN_COLOR } } } },
    },
  });
  await openChart(page);

  await expect.poll(async () => (await candleColors(page)).wickVisible).toBe(false);
  expectNoErrors(collected);
});
