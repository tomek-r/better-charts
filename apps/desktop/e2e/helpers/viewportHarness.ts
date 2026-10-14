import { expect, type Page } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_M5_INTERVAL_MS, windowCandles, type TauriStubOptions } from './tauriStub';

/**
 * Bars in the window every viewport spec loads: enough for the helper points, the
 * drawer transition and a prepended page to behave as they do on real history,
 * which the ten-bar default cannot show.
 */
export const VIEWPORT_WINDOW_BARS = 300;

const INTERVAL_SECONDS = STUB_M5_INTERVAL_MS / 1000;

/**
 * Loads an EURUSD M5 window and waits for the startup sequence to finish. The app
 * replaces the history twice (the cached snapshot, then its own history request),
 * and either replacement re-frames the view, so a spec must not touch the viewport
 * before the second one has landed.
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
  await expect.poll(() => countChanges(page, 'replaceHistory')).toBeGreaterThanOrEqual(2);
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

/** Opens a bar `slotsAhead` intervals after the current newest one, as the live feed does. */
export async function pushLiveBar(page: Page, slotsAhead = 1): Promise<void> {
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
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)!.time)).toBe(time);
}
