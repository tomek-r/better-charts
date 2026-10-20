import { expect, test } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { emitLiveBar, loadViewportWindow } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

test('a bar arriving mid-drag does not shift the bars away from the pointer', async ({ page }) => {
  await loadViewportWindow(page);
  const grabbed = await page.evaluate(() => {
    const chart = window.__chartTest!;
    const bar = chart.data().at(-21)!;
    const host = document.querySelector('.chart-host')!.getBoundingClientRect();
    return {
      timeMs: bar.time * 1000,
      x: host.left + chart.timeToX(bar.time * 1000),
      y: host.top + chart.priceScale().paneHeight / 2,
    };
  });
  const barX = () =>
    page.evaluate((timeMs) => {
      const host = document.querySelector('.chart-host')!.getBoundingClientRect();
      return host.left + window.__chartTest!.timeToX(timeMs);
    }, grabbed.timeMs);

  await page.mouse.move(grabbed.x, grabbed.y);
  await page.mouse.down();
  await page.mouse.move(grabbed.x - 60, grabbed.y, { steps: 6 });
  const beforeBar = await barX();
  const newestTime = await emitLiveBar(page);
  await page.mouse.move(grabbed.x - 100, grabbed.y, { steps: 6 });

  // The grabbed bar keeps following the pointer, new bar or not.
  expect(await barX()).toBeCloseTo(beforeBar - 40, 0);

  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)!.time)).toBe(newestTime);
});

test('a right-click on the pane does not hold live bars back', async ({ page }) => {
  await loadViewportWindow(page);
  const center = await page.evaluate(() => {
    const host = document.querySelector('.chart-host')!.getBoundingClientRect();
    return { x: host.left + host.width / 2, y: host.top + host.height / 2 };
  });
  await page.mouse.move(center.x, center.y);
  // The context menu would swallow the release, so the button stays down here.
  await page.mouse.down({ button: 'right' });
  const newestTime = await emitLiveBar(page);
  await expect.poll(() => page.evaluate(() => window.__chartTest!.data().at(-1)!.time)).toBe(newestTime);
  await page.mouse.up({ button: 'right' });
});
