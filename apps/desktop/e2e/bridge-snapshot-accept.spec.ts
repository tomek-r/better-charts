import { expect, test, type Page } from '@playwright/test';
import type { Candle } from '../src/shared/bridge/types';
import { gotoWithStub, pushEvent, windowCandles } from './helpers/tauriStub';

// A market snapshot reaches the chart on two paths: the bootstrap fetch at
// startup and the later `market-snapshot` event. Both keep only candles that
// can be rendered, and report when MT5 sent candles but none of them could be.

const NONE_VALID_MESSAGE = 'MT5 returned candles, but none of them contain valid OHLC values.';
const VALID_COUNT = 6;
const BROKEN_COUNT = 2;

/** High below low: the candle can never be drawn. */
const brokenCandle = (candle: Candle): Candle => ({ ...candle, high: '1.0000', low: '1.2000' });

/** The oldest candles are broken, so the newest stays valid and a later snapshot is not stale. */
function mixedWindow(): Candle[] {
  const window = windowCandles(VALID_COUNT + BROKEN_COUNT);
  return window.map((candle, index) => (index < BROKEN_COUNT ? brokenCandle(candle) : candle));
}

const allBrokenWindow = () => windowCandles(3).map(brokenCandle);

const snapshotOf = (candles: Candle[]) => ({ symbol: 'EURUSD', timeframe: 'M5', complete: true, candles });

const chartBarCount = (page: Page) => page.evaluate(() => window.__chartTest?.data().length ?? 0);

test('the bootstrap snapshot keeps only the valid candles', async ({ page }) => {
  await gotoWithStub(page, { responses: { get_market_snapshot: snapshotOf(mixedWindow()) } });
  await expect.poll(() => chartBarCount(page)).toBe(VALID_COUNT);
  await expect(page.getByText(NONE_VALID_MESSAGE)).toHaveCount(0);
});

test('the bootstrap snapshot reports when none of its candles are valid', async ({ page }) => {
  await gotoWithStub(page, { responses: { get_market_snapshot: snapshotOf(allBrokenWindow()) } });
  await expect(page.getByText(NONE_VALID_MESSAGE)).toBeVisible();
});

test('a later market snapshot keeps only the valid candles', async ({ page }) => {
  await gotoWithStub(page);
  await pushEvent(page, 'market-snapshot', snapshotOf(mixedWindow()));
  await expect.poll(() => chartBarCount(page)).toBe(VALID_COUNT);
  await expect(page.getByText(NONE_VALID_MESSAGE)).toHaveCount(0);
});

test('a later market snapshot reports when none of its candles are valid', async ({ page }) => {
  await gotoWithStub(page);
  await pushEvent(page, 'market-snapshot', snapshotOf(allBrokenWindow()));
  await expect(page.getByText(NONE_VALID_MESSAGE)).toBeVisible();
});
