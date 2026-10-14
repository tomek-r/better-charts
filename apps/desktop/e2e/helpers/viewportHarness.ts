import { expect, type Page } from '@playwright/test';
import {
  gotoWithStub,
  pushEvent,
  STUB_M5_INTERVAL_MS,
  stubInvocations,
  windowCandles,
  type TauriStubOptions,
} from './tauriStub';

/**
 * Bars in the window every viewport spec loads: enough for the helper points, the
 * drawer transition and a prepended page to behave as they do on real history,
 * which the ten-bar default cannot show.
 */
export const VIEWPORT_WINDOW_BARS = 300;

const INTERVAL_SECONDS = STUB_M5_INTERVAL_MS / 1000;

/**
 * Loads an EURUSD M5 window and waits for the startup sequence to finish. The app
 * replaces the history more than once (the cached snapshot, then the answer to its
 * own history request), and each replacement re-frames the view, so a spec must not
 * touch the viewport before the last one has landed.
 */
export async function loadViewportWindow(
  page: Page,
  options: { bars?: number; stub?: TauriStubOptions } = {},
): Promise<{ pageErrors: string[]; consoleErrors: string[] }> {
  const candles = windowCandles(options.bars ?? VIEWPORT_WINDOW_BARS);
  const collected = await gotoWithStub(page, {
    responses: { get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles } },
    historyByTimeframe: { M5: candles },
    ...options.stub,
  });
  // React runs the startup effect twice in development, so a replacement count
  // cannot say when the app's own history request was answered. The stub answers
  // it a task after the invoke; waiting for that invoke and then for the count to
  // hold still outlasts it.
  await expect
    .poll(async () => (await stubInvocations(page)).some((call) => call.cmd === 'request_history'))
    .toBe(true);
  let previous = -1;
  await expect
    .poll(async () => {
      const current = await countChanges(page, 'replaceHistory');
      const settled = current === previous;
      previous = current;
      await page.waitForTimeout(100);
      return settled;
    })
    .toBe(true);
  return collected;
}

export function countChanges(page: Page, caller: string): Promise<number> {
  return page.evaluate(
    (name) => window.__chartTest?.viewportChanges().filter((change) => change.caller === name).length ?? 0,
    caller,
  );
}

/**
 * Where the pane's right edge sits relative to the newest bar, in bar slots:
 * positive means empty space right of the newest candle, negative that the newest
 * candle is off screen. `from` and `lastIndex` let a spec test visibility too.
 */
export async function newestBarPlacement(page: Page): Promise<{ slots: number; from: number; lastIndex: number }> {
  return page.evaluate(() => {
    const chart = window.__chartTest!;
    const range = chart.visibleRange();
    const lastIndex = chart.data().length - 1;
    if (!range) {
      throw new Error('Chart has no visible range');
    }
    return { slots: range.to - lastIndex, from: range.from, lastIndex };
  });
}

/**
 * Delivers a bar opening `slotsAhead` intervals after the chart's newest one, as the
 * live feed does, without waiting for the chart to draw it. Returns its open time in
 * seconds.
 */
export async function emitLiveBar(page: Page, slotsAhead = 1): Promise<number> {
  const newest = await page.evaluate(() => window.__chartTest!.data().at(-1)!.time);
  const time = newest + slotsAhead * INTERVAL_SECONDS;
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    candle: {
      timeMs: time * 1000,
      open: '1.0850',
      high: '1.0860',
      low: '1.0840',
      close: '1.0855',
      tickVolume: 10,
      spread: 2,
      realVolume: 0,
    },
  });
  return time;
}

/** Delivers a live bar and waits until the chart has drawn it. */
export async function pushLiveBar(page: Page, slotsAhead = 1): Promise<void> {
  const time = await emitLiveBar(page, slotsAhead);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)!.time)).toBe(time);
}
