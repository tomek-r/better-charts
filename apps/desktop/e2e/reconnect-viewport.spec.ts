import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_NOW, stubInvocations } from './tauriStub';

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
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
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

async function pageRequests(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history_page');
}

async function waitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
  );
}

test('reconnecting with a shorter same-selection history matches initial-load framing', async ({ page, browser }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: history },
      request_history: null,
    },
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(300);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 125, to: 155 }));
  await expect.poll(() => page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBe(155);

  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'MT5 relaunched' });
  const refreshed = history.slice(-10).map((candle) => ({ ...candle, timeMs: candle.timeMs + 8 * interval }));
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: refreshed,
  });

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
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: gappedHistory },
      request_history: null,
    },
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(300);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: 125, to: 155 }));
  await expect.poll(() => page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBe(155);

  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'MT5 relaunched' });
  const refreshed = gappedHistory.map((candle) => ({ ...candle, close: '1.0855' }));
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: refreshed,
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(300);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data()[250]?.close)).toBe(1.0855);
  await waitTwoFrames(page);
  expect(await page.evaluate(() => window.__chartTest!.visibleRange()?.to)).toBeCloseTo(304, 0);

  const times = await page.evaluate(() => window.__chartTest!.data().map((bar) => bar.time * 1000));
  expect(times[200] - times[199]).toBe(2 * 24 * 60 * 60 * 1000 + interval);
  expect(times).toEqual(gappedHistory.map((candle) => candle.timeMs));
});

test('disconnect clears an older-page request and rejects its stale response', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: history },
      request_history: null,
    },
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length)).toBe(300);
  await interceptHistoryPages(page);
  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: -10, to: 20 }));
  await expect.poll(async () => (await pageRequests(page)).length).toBe(1);
  const oldRequest = (await pageRequests(page))[0];
  const oldBeforeMs = Number(oldRequest.args.beforeMs);

  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'MT5 exited' });
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'MT5 relaunched' });
  const refreshed = history.slice(-10).map((candle) => ({ ...candle, timeMs: candle.timeMs + 8 * interval }));
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: refreshed,
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(10);
  await waitTwoFrames(page);

  await pushEvent(page, 'history-page', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    beforeMs: oldBeforeMs,
    candles: history.slice(0, 290),
  });
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(10);

  await page.evaluate(() => window.__chartTest!.scrollToRange({ from: -10, to: 20 }));
  await expect.poll(async () => (await pageRequests(page)).length).toBe(2);
  const freshRequest = (await pageRequests(page))[1];
  const freshBeforeMs = Number(freshRequest.args.beforeMs);
  expect(freshBeforeMs).not.toBe(oldBeforeMs);

  await pushEvent(page, 'history-page', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    beforeMs: oldBeforeMs,
    candles: history.slice(0, 290),
  });
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(10);

  await pushEvent(page, 'history-page', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    beforeMs: freshBeforeMs,
    candles: history.slice(-20, -10),
  });
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().length)).toBe(20);
});
