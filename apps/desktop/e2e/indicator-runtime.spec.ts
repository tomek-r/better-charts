import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openChart } from './helpers/openChart';
import { gotoWithStub, pushEvent } from './helpers/tauriStub';

const SYMBOL = 'EURUSD';
const TIMEFRAME = 'M5';
const BAR_SECONDS = 300;
const MILLIS_PER_SECOND = 1000;
const SMA_DEFINITION_ID = 'sma';
const SMA_INSTANCE_ID = 'sma-1';
const SMA_LENGTH = 3;
const SHORTER_SMA_LENGTH = 2;
const TICK_STEP = 0.01;
const PRICE_DECIMALS = 5;
const COMPARISON_DIGITS = 10;
const UNKNOWN_INSTANCE_ID = 'unknown-instance';
const UNKNOWN_DEFINITION_ID = 'nope';
const STUB_TICK_VOLUME = 100;
const STUB_SPREAD = 0;
const STUB_REAL_VOLUME = 0;
const SNAPSHOT_CLOSES = [1.1005, 1.1015, 1.1025, 1.1035, 1.1045] as const;

test.beforeEach(async ({ page }) => {
  await gotoWithStub(page);
  await openChart(page);
});

test("an attached SMA draws its average over the chart's bars", async ({ page }) => {
  expect(await attachSma(page, SMA_LENGTH)).toBe(true);
  await expectDrawnSma(page, SMA_LENGTH);
});

test('an indicator the registry does not know is refused and draws nothing', async ({ page }) => {
  const attached = await page.evaluate(
    ({ instanceId, definitionId }) => window.__chartTest!.attachIndicator(instanceId, definitionId),
    { instanceId: UNKNOWN_INSTANCE_ID, definitionId: UNKNOWN_DEFINITION_ID },
  );
  expect(attached).toBe(false);
  expect(await page.evaluate(() => window.__chartTest!.indicators())).toEqual([]);
});

test('a tick moves only the forming value', async ({ page }) => {
  await attachSma(page, SMA_LENGTH);
  await expectDrawnSma(page, SMA_LENGTH);
  const formingPoints = await lineLength(page);
  const last = await lastBar(page);
  await pushLiveCandle(page, last.time * MILLIS_PER_SECOND, last.close + TICK_STEP);
  await expectDrawnSma(page, SMA_LENGTH);
  expect(await lineLength(page)).toBe(formingPoints);
});

test('a new bar closes the forming value and adds the next one', async ({ page }) => {
  await attachSma(page, SMA_LENGTH);
  await expectDrawnSma(page, SMA_LENGTH);
  const before = await drawnValues(page);
  const last = await lastBar(page);
  await pushLiveCandle(page, (last.time + BAR_SECONDS) * MILLIS_PER_SECOND, last.close + TICK_STEP);
  await expectDrawnSma(page, SMA_LENGTH);
  const after = await drawnValues(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after[before.length - 1]).toBeCloseTo(before[before.length - 1], COMPARISON_DIGITS);
});

test('new settings recompute the whole line', async ({ page }) => {
  await attachSma(page, SMA_LENGTH);
  await expectDrawnSma(page, SMA_LENGTH);
  const longerLine = await lineLength(page);
  await setSmaLength(page, SHORTER_SMA_LENGTH);
  await expectDrawnSma(page, SHORTER_SMA_LENGTH);
  expect(await lineLength(page)).toBe(longerLine + 1);
  const settings = await page.evaluate(() => window.__chartTest!.attachedIndicators()[0].settings);
  expect(settings.length).toBe(SHORTER_SMA_LENGTH);
});

test('a new history loads the attached indicators again', async ({ page }) => {
  await attachSma(page, SMA_LENGTH);
  await expectDrawnSma(page, SMA_LENGTH);
  await pushSnapshot(page, SNAPSHOT_CLOSES);
  await expect.poll(() => barCount(page)).toBe(SNAPSHOT_CLOSES.length);
  await expect.poll(() => lineLength(page)).toBe(SNAPSHOT_CLOSES.length - SMA_LENGTH + 1);
  await expectDrawnSma(page, SMA_LENGTH);
});

test('detaching removes the line', async ({ page }) => {
  await attachSma(page, SMA_LENGTH);
  await expectDrawnSma(page, SMA_LENGTH);
  await page.evaluate((instanceId) => window.__chartTest!.detachIndicator(instanceId), SMA_INSTANCE_ID);
  expect(await page.evaluate(() => window.__chartTest!.indicators())).toEqual([]);
  expect(await page.evaluate(() => window.__chartTest!.attachedIndicators())).toEqual([]);
});

/**
 * The oracle: the plain mean of every `length` window of the closes the chart itself holds,
 * which is exactly what an SMA line keeps once its warm-up windows are gone.
 */
function smaOf(closes: readonly number[], length: number): number[] {
  return closes.flatMap((_, index) => {
    if (index + 1 < length) {
      return [];
    }
    const recent = closes.slice(index + 1 - length, index + 1);
    return [recent.reduce((total, close) => total + close, 0) / length];
  });
}

function candleAt(timeMs: number, price: number) {
  const quote = price.toFixed(PRICE_DECIMALS);
  return {
    timeMs,
    open: quote,
    high: quote,
    low: quote,
    close: quote,
    tickVolume: STUB_TICK_VOLUME,
    spread: STUB_SPREAD,
    realVolume: STUB_REAL_VOLUME,
  };
}

async function attachSma(page: Page, length: number): Promise<boolean> {
  return page.evaluate(
    ({ instanceId, definitionId, smaLength }) =>
      window.__chartTest!.attachIndicator(instanceId, definitionId, { length: smaLength }),
    { instanceId: SMA_INSTANCE_ID, definitionId: SMA_DEFINITION_ID, smaLength: length },
  );
}

async function setSmaLength(page: Page, length: number): Promise<void> {
  await page.evaluate(
    ({ instanceId, smaLength }) => window.__chartTest!.setIndicatorSettings(instanceId, { length: smaLength }),
    { instanceId: SMA_INSTANCE_ID, smaLength: length },
  );
}

async function chartCloses(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__chartTest!.data().map((bar) => bar.close));
}

async function barCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.data().length);
}

async function lastBar(page: Page): Promise<{ time: number; close: number }> {
  const bars = await page.evaluate(() => window.__chartTest!.data());
  const last = bars[bars.length - 1];
  if (!last) {
    throw new Error('the chart holds no bars');
  }
  return { time: last.time, close: last.close };
}

/** The values of the single attached line, in the order the layer draws them. */
async function drawnValues(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const drawn = window.__chartTest!.indicators()[0];
    if (!drawn) {
      return [];
    }
    return drawn.plots[0]?.points.map((point) => point.value) ?? [];
  });
}

async function lineLength(page: Page): Promise<number> {
  return (await drawnValues(page)).length;
}

async function pushLiveCandle(page: Page, timeMs: number, price: number): Promise<void> {
  const candle = candleAt(timeMs, price);
  await pushEvent(page, 'bar-update', { symbol: SYMBOL, timeframe: TIMEFRAME, candle });
  await expect.poll(async () => (await lastBar(page)).time).toBe(timeMs / MILLIS_PER_SECOND);
  await expect.poll(async () => (await lastBar(page)).close).toBeCloseTo(Number(candle.close), COMPARISON_DIGITS);
}

async function pushSnapshot(page: Page, closes: readonly number[]): Promise<void> {
  const lastTimeMs = (await lastBar(page)).time * MILLIS_PER_SECOND;
  const firstTimeMs = lastTimeMs - (closes.length - 1) * BAR_SECONDS * MILLIS_PER_SECOND;
  const candles = closes.map((close, index) => candleAt(firstTimeMs + index * BAR_SECONDS * MILLIS_PER_SECOND, close));
  await pushEvent(page, 'market-snapshot', { symbol: SYMBOL, timeframe: TIMEFRAME, complete: true, candles });
}

function expectSmaLine(drawn: readonly number[], closes: readonly number[], length: number): void {
  const expected = smaOf(closes, length);
  expect(drawn).toHaveLength(expected.length);
  expected.forEach((mean, index) => {
    expect(drawn[index]).toBeCloseTo(mean, COMPARISON_DIGITS);
  });
}

/** Waits for the line to hold one point per complete window, then compares it with the oracle. */
async function expectDrawnSma(page: Page, length: number): Promise<void> {
  const closes = await chartCloses(page);
  await expect.poll(() => lineLength(page)).toBe(closes.length - length + 1);
  expectSmaLine(await drawnValues(page), closes, length);
}
