import { expect, test } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { loadViewportWindow, newestBarPlacement, pushLiveBars } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

// A flush carries every bar that arrived since the last frame: all of them at once
// when the window was hidden or the main thread stalled.
for (const count of [2, 5, 12]) {
  test(`${count} bars flushed together keep the view on the newest bar`, async ({ page }) => {
    await loadViewportWindow(page);
    const before = await newestBarPlacement(page);

    await pushLiveBars(
      page,
      Array.from({ length: count }, () => 1),
    );

    await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(before.slots, 5);
  });
}
