import { expect, test, type Page } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { loadViewportWindow, newestBarPlacement, pushLiveBars, shiftView } from './helpers/viewportHarness';

// The chart follows new bars while the newest bar is in view, and a deliberate
// placement of it (zoomed, panned into the right margin) is kept at its distance
// from the right edge. It stops following only when the user moves the newest bar
// out of view, and resumes when it comes back.

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

async function visibleTo(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.visibleRange()!.to);
}

test('zooming with the cursor left of the edge keeps following', async ({ page }) => {
  await loadViewportWindow(page);
  const host = await page.evaluate(() => {
    const { left, top, width, height } = document.querySelector('.chart-host')!.getBoundingClientRect();
    return { left, top, width, height };
  });
  await page.mouse.move(host.left + host.width / 4, host.top + host.height / 2);
  const before = await newestBarPlacement(page);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await newestBarPlacement(page)).slots).not.toBeCloseTo(before.slots, 0);
  const zoomed = await newestBarPlacement(page);
  expect(zoomed.from).toBeLessThan(zoomed.lastIndex);

  await pushLiveBars(page, [1]);

  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(zoomed.slots, 5);
});

test('panning into the right margin keeps following at the chosen distance', async ({ page }) => {
  await loadViewportWindow(page);
  await shiftView(page, 30);
  const parked = await newestBarPlacement(page);
  expect(parked.slots).toBeGreaterThan(20);

  await pushLiveBars(page, [1]);
  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(parked.slots, 5);

  await pushLiveBars(page, [3, 1]);
  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(parked.slots, 5);
});

test('panning the newest bar out of view stops following, and bringing it back resumes', async ({ page }) => {
  await loadViewportWindow(page);
  await shiftView(page, -250);
  const away = await newestBarPlacement(page);
  expect(away.slots).toBeLessThan(0);
  const awayTo = await visibleTo(page);

  await pushLiveBars(page, [1, 1]);
  // The view stays on the bars the user is looking at.
  await expect.poll(() => visibleTo(page)).toBeCloseTo(awayTo, 5);

  // Bring the newest bar back into view: following resumes from where it was put.
  await shiftView(page, 250 + 2);
  const back = await newestBarPlacement(page);
  expect(back.slots).toBeGreaterThanOrEqual(0);

  await pushLiveBars(page, [1]);

  await expect.poll(async () => (await newestBarPlacement(page)).slots).toBeCloseTo(back.slots, 5);
});
