import { expect, test, type Page } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { loadViewportWindow, newestBarPlacement, pushLiveBars } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

/** Helper points the chart currently holds: a bar further ahead than this opens past all of them. */
async function helperPointCount(page: Page): Promise<number> {
  const changes = await page.evaluate(() => window.__chartTest!.viewportChanges());
  return changes.at(-1)!.after.futureCount;
}

// MT5 opens no bar for a minute without ticks, and a session break leaves a longer
// hole, so the next bar opens several intervals ahead, past the helper points when
// the hole is long enough.
for (const gap of ['one interval', 'three intervals', 'beyond the helper points']) {
  test(`a bar opening ${gap} ahead keeps the view on the newest bar`, async ({ page }) => {
    await loadViewportWindow(page);
    const before = await newestBarPlacement(page);
    const slotsAhead = { 'one interval': 1, 'three intervals': 3 }[gap] ?? (await helperPointCount(page)) + 20;

    await pushLiveBars(page, [slotsAhead]);

    await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(before.slots, 5);
  });
}

test('a run of bars with holes keeps the view on the newest bar after every flush', async ({ page }) => {
  await loadViewportWindow(page);
  const before = await newestBarPlacement(page);
  const beyond = (await helperPointCount(page)) + 20;

  for (const gaps of [[1, 3, 1], [beyond], [2, 1, 1, 4]]) {
    await pushLiveBars(page, gaps);
    await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(before.slots, 5);
  }
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
