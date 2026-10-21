import { expect, test, type Page } from '@playwright/test';
import { holdIdleCallbacks, pushEvent, windowCandles } from './helpers/tauriStub';
import { loadViewportWindow, newestBarPlacement, shiftView, VIEWPORT_WINDOW_BARS } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

/**
 * Parks the view `parkedBack` bars left of where it starts, then answers the current
 * selection with a window whose newest bar is `newerBars` intervals later, and
 * expects the view to keep its distance from the newest bar.
 */
async function expectDistanceKept(page: Page, newerBars: number, parkedBack: number): Promise<void> {
  await loadViewportWindow(page);
  await shiftView(page, -parkedBack);
  const before = await newestBarPlacement(page);

  const candles = windowCandles(VIEWPORT_WINDOW_BARS, 1.085, -newerBars);
  await pushEvent(page, 'market-snapshot', { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles });
  const newestTime = candles[candles.length - 1].timeMs / 1000;
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)!.time)).toBe(newestTime);

  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(before.slots, 5);
}

for (const newerBars of [1, 3, 8]) {
  test(`a window ${newerBars} bars newer keeps the default view on the newest bar`, async ({ page }) => {
    await expectDistanceKept(page, newerBars, 0);
  });

  test(`a window ${newerBars} bars newer keeps a parked view at the same distance from the newest bar`, async ({
    page,
  }) => {
    await expectDistanceKept(page, newerBars, 40);
  });
}
