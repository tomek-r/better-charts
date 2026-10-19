import { expect, test } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { loadViewportWindow, newestBarPlacement, VIEWPORT_WINDOW_BARS } from './helpers/viewportHarness';

const PAGE_BARS = 200;

test('the idle prefetch prepends a page without moving a view parked at the right edge', async ({ page }) => {
  const idle = await holdIdleCallbacks(page);
  await loadViewportWindow(page, { stub: { olderHistoryPages: 1, olderHistoryBars: PAGE_BARS } });
  const newestBarX = () =>
    page.evaluate(() => {
      const chart = window.__chartTest!;
      return chart.timeToX(chart.data().at(-1)!.time * 1000);
    });
  const before = { placement: await newestBarPlacement(page), x: await newestBarX() };

  await idle.runAll();
  await expect
    .poll(() => page.evaluate(() => window.__chartTest!.data().length))
    .toBe(VIEWPORT_WINDOW_BARS + PAGE_BARS);

  // The page grew the history behind the view; the newest bar stays on the same pixel.
  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(before.placement.slots, 5);
  await expect.poll(newestBarX).toBeCloseTo(before.x, 0);
});
