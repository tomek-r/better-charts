import { test, expect, type Page } from '@playwright/test';
import { HISTORY_BARS } from '../src/shared/bridge/limits';
import { DEFAULT_BAR_SPACING } from '../src/features/chart/engine/futureTimePoints';
import { gotoWithStub, holdIdleCallbacks, stubInvocations, windowCandles } from './helpers/tauriStub';

const WINDOW_BARS = 400;
const PAGE_BARS = 5;

async function calls(page: Page, cmd: string) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === cmd);
}
async function barCount(page: Page) {
  return page.evaluate(() => window.__chartTest?.data().length ?? 0);
}

const stubOptions = {
  responses: {
    get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(WINDOW_BARS) },
  },
  historyByTimeframe: { M5: windowCandles(WINDOW_BARS), M1: windowCandles(WINDOW_BARS, 1.2) },
  olderHistoryPages: 5,
  olderHistoryBars: PAGE_BARS,
};

/** Loads the app with the idle prefetch parked: it is armed (one held callback) but no page was requested. */
async function startWithPrefetchHeld(page: Page) {
  const idle = await holdIdleCallbacks(page);
  await gotoWithStub(page, stubOptions);
  await expect.poll(idle.held).toBe(1);
  expect(await calls(page, 'request_history_page')).toHaveLength(0);
  return idle;
}

test('the startup history request covers the measured pane, not a whole page', async ({ page }) => {
  await gotoWithStub(page, stubOptions);
  await expect.poll(async () => (await calls(page, 'request_history')).length).toBeGreaterThan(0);
  const [request] = await calls(page, 'request_history');
  const bars = Number(request.args.bars);
  const paneWidth = await page.evaluate(
    () =>
      document.querySelector('.chart-host')!.getBoundingClientRect().width - window.__chartTest!.priceScale().axisWidth,
  );
  // Enough to fill the visible span at the default spacing of 10px, never 0 and
  // well below the page size.
  expect(bars).toBeGreaterThanOrEqual(Math.ceil(paneWidth / DEFAULT_BAR_SPACING));
  expect(bars).toBeGreaterThanOrEqual(100);
  expect(bars).toBeLessThan(HISTORY_BARS);
});

test('one older page is prefetched when idle, and not chained', async ({ page }) => {
  const idle = await startWithPrefetchHeld(page);

  await idle.runAll();
  await expect.poll(async () => await barCount(page)).toBe(WINDOW_BARS + PAGE_BARS);
  const requests = await calls(page, 'request_history_page');
  expect(requests).toHaveLength(1);
  expect(requests[0].args).toMatchObject({ symbol: 'EURUSD', timeframe: 'M5', bars: HISTORY_BARS });
  // The landed page arms no further idle work, and the view has no gap to page into.
  expect(await idle.held()).toBe(0);
  expect(await calls(page, 'request_history_page')).toHaveLength(1);
});

test('a pending prefetch is cancelled by a timeframe switch and runs once for the new selection', async ({ page }) => {
  const idle = await startWithPrefetchHeld(page);

  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__chartTest?.data()[0]?.open)) ?? 0).toBe(1.2);
  // Only the new selection's prefetch remains.
  await expect.poll(idle.held).toBe(1);
  await idle.runAll();
  await expect.poll(async () => (await calls(page, 'request_history_page')).length).toBe(1);
  expect((await calls(page, 'request_history_page'))[0].args).toMatchObject({ timeframe: 'M1' });
});
