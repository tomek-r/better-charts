import { expect, test } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

interface Shift {
  value: number;
  sources: { node: string; dy: number; dh: number }[];
}

// Regression: the chart frame must not move once it first paints. The timeframe
// header used to be empty until the handshake supplied supportedTimeframes, so
// its buttons arrived late and pushed `.chart-frame` down (CLS ~0.12).
// Narrow widths wrap the 21 timeframe buttons onto several rows, so the reserve
// must follow the real wrapping rather than a fixed height.
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 800, height: 900 },
  { width: 400, height: 800 },
]) {
  test(`chart frame does not shift while the timeframe header and data load at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const shifts: Shift[] = [];
      (window as unknown as { __shifts: Shift[] }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          hadRecentInput: boolean;
          value: number;
          sources: { node: Node | null; previousRect: DOMRect; currentRect: DOMRect }[];
        }[]) {
          if (entry.hadRecentInput) {
            continue;
          }
          shifts.push({
            value: entry.value,
            sources: entry.sources.map((s) => ({
              node: s.node instanceof Element ? s.node.className : String(s.node?.nodeName),
              dy: s.currentRect.y - s.previousRect.y,
              dh: s.currentRect.height - s.previousRect.height,
            })),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await gotoWithStub(page);
    const tabs = page.getByRole('group', { name: 'Chart timeframe' });
    await expect(tabs.getByRole('button', { name: '30m', exact: true })).toBeEnabled();
    await expect(page.locator('.chart-host canvas').first()).toBeVisible();
    // Let any trailing layout-shift entries flush.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
    expect(shifts).toEqual([]);
  });
}
