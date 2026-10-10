import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_NOW, stubInvocations, type StubInternals } from './helpers/tauriStub';

const interval = 300_000;
const history = Array.from({ length: 300 }, (_, index) => ({
  timeMs: STUB_NOW - (300 - index) * interval,
  open: '1.0850',
  high: '1.0860',
  low: '1.0840',
  close: '1.0854',
  tickVolume: 10,
  spread: 2,
  realVolume: 0,
}));
const gappedHistory = history.map((candle, index) => ({
  ...candle,
  timeMs: candle.timeMs + (index >= 200 ? 2 * 24 * 60 * 60 * 1000 : 0),
}));

async function interceptHistoryPages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as StubInternals & {
      __E2E_TAURI_STUB__: {
        invocations: Array<{ cmd: string; args: Record<string, unknown> }>;
      };
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'request_history_page') {
        w.__E2E_TAURI_STUB__.invocations.push({ cmd, args: args ?? {} });
        return Promise.resolve(null);
      }
      return invoke(cmd, args);
    };
  });
}

/** Loads `candles` as the EURUSD M5 snapshot and waits until all 300 bars are charted. */
async function loadHistory(page: Page, candles: unknown[]): Promise<void> {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles },
      request_history: null,
    },
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(300);
}

/** Drops and restores the bridge, then answers the resync with `candles` as the fresh snapshot. */
async function reconnectWithSnapshot(page: Page, candles: unknown[]): Promise<void> {
  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'MT5 relaunched' });
  await pushEvent(page, 'market-snapshot', { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles });
}

async function pushHistoryPage(page: Page, beforeMs: number, candles: unknown[]): Promise<void> {
  await pushEvent(page, 'history-page', { symbol: 'EURUSD', timeframe: 'M5', complete: true, beforeMs, candles });
}

async function pageRequests(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history_page');
}

async function waitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
  );
}

test('reconnecting with a shorter same-selection history matches initial-load framing', async ({ page, browser }) => {
  await loadHistory(page, history);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 125, to: 155 }));
  await expect.poll(() => page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBe(155);

  const refreshed = history.slice(-10).map((candle) => ({ ...candle, timeMs: candle.timeMs + 8 * interval }));
  await reconnectWithSnapshot(page, refreshed);

  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(10);
  await expect
    .poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)?.time))
    .toBe(refreshed.at(-1)!.timeMs / 1000);
  await waitTwoFrames(page);
  await waitTwoFrames(page);
  await waitTwoFrames(page);
  const reconnectRange = await page.evaluate(() => window.__chartTest!.visibleRange());

  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const referencePage = await browser.newPage({ viewport });
  await gotoWithStub(referencePage, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: refreshed },
      request_history: null,
    },
  });
  await expect.poll(() => referencePage.evaluate(() => window.__chartTest?.data().length)).toBe(10);
  await waitTwoFrames(referencePage);
  const initialLoadRange = await referencePage.evaluate(() => window.__chartTest!.visibleRange());
  expect(reconnectRange?.from).toBeCloseTo(initialLoadRange?.from ?? NaN, 0);
  expect(reconnectRange?.to).toBeCloseTo(initialLoadRange?.to ?? NaN, 0);
  await referencePage.close();
});

test('reconnect history keeps real market gaps without synthesizing candles', async ({ page }) => {
  await loadHistory(page, gappedHistory);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 125, to: 155 }));
  await expect.poll(() => page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBe(155);

  const refreshed = gappedHistory.map((candle) => ({ ...candle, close: '1.0855' }));
  await reconnectWithSnapshot(page, refreshed);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(300);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data()[250]?.close)).toBe(1.0855);
  await waitTwoFrames(page);
  expect(await page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBeCloseTo(304, 0);

  const times = await page.evaluate(() => window.__chartTest!.data().map((bar) => bar.time * 1000));
  expect(times[200] - times[199]).toBe(2 * 24 * 60 * 60 * 1000 + interval);
  expect(times).toEqual(gappedHistory.map((candle) => candle.timeMs));
});

test('disconnect clears an older-page request and rejects its stale response', async ({ page }) => {
  await loadHistory(page, history);
  await interceptHistoryPages(page);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: -10, to: 20 }));
  await expect.poll(async () => (await pageRequests(page)).length).toBe(1);
  const oldRequest = (await pageRequests(page))[0];
  const oldBeforeMs = Number(oldRequest.args.beforeMs);

  const refreshed = history.slice(-10).map((candle) => ({ ...candle, timeMs: candle.timeMs + 8 * interval }));
  await reconnectWithSnapshot(page, refreshed);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(10);
  await waitTwoFrames(page);

  await pushHistoryPage(page, oldBeforeMs, history.slice(0, 290));
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(10);

  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: -10, to: 20 }));
  await expect.poll(async () => (await pageRequests(page)).length).toBe(2);
  const freshRequest = (await pageRequests(page))[1];
  const freshBeforeMs = Number(freshRequest.args.beforeMs);
  expect(freshBeforeMs).not.toBe(oldBeforeMs);

  await pushHistoryPage(page, oldBeforeMs, history.slice(0, 290));
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(10);

  await pushHistoryPage(page, freshBeforeMs, history.slice(-20, -10));
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(20);
});
