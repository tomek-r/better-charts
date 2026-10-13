import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_NOW, stubInvocations, windowCandles } from './helpers/tauriStub';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DETACHED_BAR_TIME_MS = Math.floor(STUB_NOW / 300_000) * 300_000 + TWO_HOURS_MS;
const REFRESH_ATTEMPTS = 5;
const detachedBar = {
  timeMs: DETACHED_BAR_TIME_MS,
  open: '1.0900',
  high: '1.0910',
  low: '1.0890',
  close: '1.0905',
  tickVolume: 5,
  spread: 2,
  realVolume: 0,
};

const pushStaleSnapshot = (page: Page) =>
  pushEvent(page, 'market-snapshot', { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: windowCandles(10) });

/** The first history of a symbol, answered before MT5 synchronized the series: it ends hours ago. */
async function loadStaleHistory(page: Page): Promise<void> {
  await gotoWithStub(page, { responses: { request_history: null } });
  // The startup request must have left before the snapshot answers it.
  await expect.poll(() => historyRequestCount(page)).toBe(1);
  await pushStaleSnapshot(page);
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(10);
}

async function historyRequestCount(page: Page): Promise<number> {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length;
}

const pushDetachedBar = (page: Page) =>
  pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle: detachedBar });

test('a live bar far past the newest history bar is withheld and the latest history is re-requested', async ({
  page,
}) => {
  await loadStaleHistory(page);
  const requestsBefore = await historyRequestCount(page);

  await pushDetachedBar(page);

  await expect.poll(() => historyRequestCount(page)).toBe(requestsBefore + 1);
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(10);

  const freshHistory = [...windowCandles(10), detachedBar];
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: freshHistory,
  });

  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(11);
  expect(await page.evaluate(() => window.__chartTest!.data().at(-1)?.time)).toBe(DETACHED_BAR_TIME_MS / 1000);
});

test('a detached live bar is drawn once the bounded refresh attempts are used up', async ({ page }) => {
  test.setTimeout(60_000);
  await loadStaleHistory(page);
  const requestsBefore = await historyRequestCount(page);

  // The refreshes keep returning the same stale history; backoff is 0.5, 1, 2, 4 and 8 s.
  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    await pushDetachedBar(page);
    await expect.poll(() => historyRequestCount(page), { timeout: 15_000 }).toBe(requestsBefore + attempt);
    await pushStaleSnapshot(page);
  }

  await pushDetachedBar(page);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(11);
  expect(await historyRequestCount(page)).toBe(requestsBefore + REFRESH_ATTEMPTS);
});
