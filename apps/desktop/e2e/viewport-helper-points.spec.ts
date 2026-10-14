import { expect, test, type Page } from '@playwright/test';
import { openTradePanel } from './helpers/panel';
import { expectNoErrors, holdIdleCallbacks } from './helpers/tauriStub';
import { countChanges, loadViewportWindow } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

async function chartHostWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('.chart-host')!.getBoundingClientRect().width);
}

/** Waits until the host width stops changing, i.e. the drawer transition has ended. */
async function waitForWidthToSettle(page: Page): Promise<void> {
  let previous = -1;
  await expect
    .poll(async () => {
      const current = await chartHostWidth(page);
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
}

test('a resize that leaves enough helper points does not rebuild them', async ({ page }) => {
  await loadViewportWindow(page);
  const height = page.viewportSize()!.height;
  const paneHeight = () => page.evaluate(() => window.__chartTest!.priceScale().paneHeight);
  const before = await paneHeight();
  await page.evaluate(() => window.__chartTest!.clearViewportChanges());

  await page.setViewportSize({ width: page.viewportSize()!.width, height: height - 80 });
  await expect.poll(paneHeight).toBeLessThan(before);

  expect(await countChanges(page, 'extendFuture')).toBe(0);
});

test('the view keeps its distance from the newest bar at every frame of a drawer open and close', async ({ page }) => {
  const collected = await loadViewportWindow(page);
  const initial = await page.evaluate(() => {
    const chart = window.__chartTest!;
    return chart.visibleRange()!.to - (chart.data().length - 1);
  });
  await page.evaluate(() => {
    window.__chartTest!.clearViewportChanges();
    // The library applies a write when it paints, so a read in the task after the
    // frame shows what the user saw in it.
    const frames: number[] = [];
    const sample = () => {
      requestAnimationFrame(() =>
        setTimeout(() => {
          const chart = window.__chartTest!;
          frames.push(chart.visibleRange()!.to - (chart.data().length - 1));
          sample();
        }, 0),
      );
    };
    sample();
    (window as unknown as { __frames: number[] }).__frames = frames;
  });

  await openTradePanel(page);
  await waitForWidthToSettle(page);
  await page.getByLabel('Toggle trade panel').click();
  await expect(page.getByLabel('Toggle trade panel')).toHaveAttribute('aria-expanded', 'false');
  await waitForWidthToSettle(page);

  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  expect(frames.length).toBeGreaterThan(10);
  for (const slots of frames) {
    expect(slots).toBeCloseTo(initial, 5);
  }
  const changes = await page.evaluate(() => window.__chartTest!.viewportChanges());
  // Helper points are rebuilt only to grow them.
  for (const change of changes.filter((entry) => entry.caller === 'extendFuture')) {
    expect(change.after.futureCount).toBeGreaterThan(change.before.futureCount);
  }
  expectNoErrors(collected);
});
