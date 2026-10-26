import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, type TauriStubOptions } from './helpers/tauriStub';

interface Shift {
  value: number;
  sources: { node: string; dy: number; dh: number }[];
}

// Regression: the chart frame must not move once it first paints. The timeframe
// header used to be empty until the handshake supplied supportedTimeframes, so
// its buttons arrived late and pushed `.chart-frame` down (CLS ~0.12).
// Narrow widths wrap the 21 timeframe buttons onto several rows, so the reserve
// must follow the real wrapping rather than a fixed height.
async function expectNoLayoutShift(page: Page, viewport: { width: number; height: number }, stub?: TauriStubOptions) {
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
  await gotoWithStub(page, stub);
  const tabs = page.getByRole('group', { name: 'Chart timeframe' });
  await expect(tabs.getByRole('button', { name: '15m', exact: true })).toBeEnabled();
  await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  // Let any trailing layout-shift entries flush.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts).toEqual([]);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 800, height: 900 },
  { width: 400, height: 800 },
  // Narrow enough that the "Waiting for symbol" placeholder wraps with macOS fonts, as it does at 400px on Linux CI.
  { width: 340, height: 800 },
]) {
  test(`chart frame does not shift while the timeframe header and data load at ${viewport.width}px`, async ({
    page,
  }) => {
    await expectNoLayoutShift(page, viewport);
  });
}

// The account badge arrives with the async snapshot, left of the search button. A very long company
// leaves the bar no free space on any OS, so the badge must absorb the shortage instead of pushing or
// squeezing the buttons beside it.
test('a very long broker company does not shift the top bar buttons at 800px', async ({ page }) => {
  await expectNoLayoutShift(
    page,
    { width: 800, height: 900 },
    {
      responses: {
        get_account_snapshot: {
          accountLogin: '50123456',
          accountTradeModeName: 'demo',
          accountCompany: 'A Very Long Broker Company Name International Holdings Ltd',
          currency: 'USD',
        },
      },
    },
  );
});
