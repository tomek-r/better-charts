import { test, expect, type Locator, type Page } from '@playwright/test';
import { openTradePanel } from './helpers/panel';
import { setupScreen } from './helpers/setupGuide';
import { gotoCollectingErrors, gotoWithStub, pushEvent, STUB_NOW } from './helpers/tauriStub';

// Without the Tauri shell, every `invoke()` call fails (window.__TAURI_INTERNALS__
// is missing). The app swallows those failures into its `tauriAvailable=false`
// fallback, but browser console noise mentioning tauri/invoke is expected.
const EXPECTED_CONSOLE_NOISE = /tauri|invoke/i;

function unexpectedConsoleErrors(consoleErrors: string[]) {
  return consoleErrors.filter((text) => !EXPECTED_CONSOLE_NOISE.test(text));
}

/** Whether `locator` is the topmost element at its own centre, so nothing is painted over it. */
async function isTopmostAtCentre(locator: Locator): Promise<boolean> {
  return locator.evaluate((element: HTMLElement) => {
    const previous = element.style.pointerEvents;
    element.style.pointerEvents = 'auto';
    try {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
    } finally {
      element.style.pointerEvents = previous;
    }
  });
}

/** Asserts the chart's chrome — host, heading, tool rail and the topbar toggles — reads `visibility`. */
async function expectChartChrome(page: Page, visibility: 'hidden' | 'visible'): Promise<void> {
  await expect(page.locator('.chart-host')).toHaveCSS('visibility', visibility);
  await expect(page.locator('.chart-heading')).toHaveCSS('visibility', visibility);
  await expect(page.locator('.tool-rail')).toHaveCSS('visibility', visibility);
  await expect(page.getByLabel('Search symbols')).toHaveCSS('visibility', visibility);
  await expect(page.getByLabel('Toggle trade panel')).toHaveCSS('visibility', visibility);
}

test('page loads with the Better Charts title and no uncaught errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = await gotoCollectingErrors(page);
  // Brand shows the app version — injected from package.json, never hardcoded.
  const brandVersion = page.locator('.brand small');
  await expect(brandVersion).toHaveText(/^v\d+\.\d+\.\d+$/);
  // The document title carries the same version, written into the built HTML.
  await expect(page).toHaveTitle(`Better Charts ${(await brandVersion.textContent()) ?? ''}`);
  // Uncaught page errors always fail the smoke test.
  expect(pageErrors).toEqual([]);
  // Console errors are allowed only when they mention the missing Tauri runtime.
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test('sidebar keeps the trading surfaces and drops the status/account/profile cards', async ({ page }) => {
  // The shared setup screen covers the window without a bridge, so the panel needs a connected stub.
  const { pageErrors } = await gotoWithStub(page);
  // The panel is a slide-out drawer now (closed by default) — open it first.
  await openTradePanel(page);
  const sidebar = page.locator('aside.trade-panel');
  await expect(sidebar).toBeVisible();
  // KEEP: the order ticket. Positions needs a portfolio snapshot, so its
  // visible pin lives in execution-flow's stubbed connect test.
  await expect(sidebar.locator('section.order-ticket')).toBeVisible();
  // The Order panel is gone — command lifecycle is log-only (owner).
  await expect(sidebar.locator('section.order-panel-card')).toHaveCount(0);
  // REMOVED from the right panel:
  await expect(sidebar.locator('.status-hero')).toHaveCount(0);
  await expect(sidebar.locator('.instrument-card')).toHaveCount(0);
  await expect(sidebar.locator('.account-card')).toHaveCount(0);
  await expect(sidebar.locator('.profile-card')).toHaveCount(0);
  await expect(sidebar.locator('.error-note')).toHaveCount(0);
  await expect(page.locator('#risk-title')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('chart host element is mounted in the chart frame', async ({ page }) => {
  const { pageErrors } = await gotoCollectingErrors(page);
  // Stable selector: App.tsx renders <div ref={chartHost} className="chart-host">.
  const chartHost = page.locator('.chart-host');
  // Without candles the empty chart is hidden, but it stays mounted.
  await expect(chartHost).toBeAttached();
  await expect(chartHost).toHaveAttribute('aria-label', 'Market chart');
  expect(pageErrors).toEqual([]);
});

test('order ticket renders with SL off by default', async ({ page }) => {
  // The ticket's drawer opens from the topbar, which the setup screen covers without a bridge.
  const { pageErrors, consoleErrors } = await gotoWithStub(page);
  // The ticket lives in the slide-out drawer (closed by default) — open it.
  await openTradePanel(page);
  // The TV ticket renders with SL off by default (optional at placement)
  // and TP disabled; the price row exists but is inert without a quote.
  const ticket = page.locator('section.order-ticket');
  await expect(ticket).toBeVisible();
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  // No Order panel — its banner/checklist/commands surface is gone (owner).
  await expect(page.locator('.order-panel-card')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test('shows the setup screen in place of the chart without the bridge', async ({ page }) => {
  const { pageErrors, consoleErrors } = await gotoCollectingErrors(page);
  // Runtime label and footer are gone from the UI (owner).
  await expect(page.locator('.runtime-label')).toHaveCount(0);
  await expect(page.locator('.app-footer')).toHaveCount(0);
  // Without a bridge the full-window setup screen stands in for the chart and its loader.
  const screen = setupScreen(page);
  await expect(screen).toBeVisible();
  const heading = screen.locator('.loading-message strong');
  await expect(heading).toHaveText('Connect MetaTrader 5');
  // The shared loader is the volume profile's loading animation.
  await expect(screen.locator('.loading-message canvas.loader')).toBeVisible();
  // Hit testing with text enabled detects canvases painted over the message.
  expect(await isTopmostAtCentre(heading)).toBe(true);
  // Without candles the chart chrome stays hidden behind the wait.
  await expectChartChrome(page, 'hidden');
  // The whole chart area is blank: heading (title and quotes) hidden, section background transparent.
  await expect(page.locator('.chart-section')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(pageErrors).toEqual([]);
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

// ── Drawer regression: fullscreen chart + slide-out right panel. The layout
// keeps the chart full-bleed under the 68px topbar and hides the trade panel
// (order ticket + Positions) behind the topbar "Panel" button — opening the
// drawer narrows the chart; at ≤900px widths the drawer overlays instead.

/** Chart-frame width, polled until two consecutive samples agree — i.e. the
 *  0.2s width transition has settled, without an arbitrary sleep. */
async function settledFrameWidth(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const width = (await page.locator('.chart-frame').boundingBox())?.width ?? -1;
        const stable = width === last;
        last = width;
        return stable;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return last;
}

test.describe('drawer regression (fullscreen chart layout)', () => {
  // Fixed-width icon column on the left edge; permanent chrome, like the topbar.
  const TOOL_RAIL_PX = 52;
  // Fixed-width icon strip on the right edge; the trade drawer sits left of it.
  const SIDE_DRAWER_STRIP_PX = 52;
  // Gap between the chart frame and the side chrome.
  const SIDE_GAP_PX = 14;
  // Dashboard and section chrome that takes width off the viewport.
  const SECTION_CHROME_PX = 80;
  // Width of the trade drawer when open.
  const DRAWER_PX = 330;
  // Closed-state budget: section chrome, side gap, left tool rail and right strip.
  const CLOSED_FRAME_MIN_WIDTH = 1440 - SECTION_CHROME_PX - SIDE_GAP_PX - TOOL_RAIL_PX - SIDE_DRAWER_STRIP_PX;
  // Open-state dashboard padding: drawer, gap, and the right strip (396px total).
  const OPEN_DASHBOARD_PADDING = `${DRAWER_PX + SIDE_GAP_PX + SIDE_DRAWER_STRIP_PX}px`;

  // Fixed viewport: the width assertions below are calibrated for 1440px.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('closed by default: toggle collapsed, panel hidden, chart frame full width', async ({ page }) => {
    const { pageErrors, consoleErrors } = await gotoCollectingErrors(page);
    const toggle = page.getByLabel('Toggle trade panel');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('aside.trade-panel')).toBeHidden();
    const frame = await page.locator('.chart-frame').boundingBox();
    // Full-bleed chart: only the dashboard/section chrome (~74px measured),
    // the 14px side gap, the fixed 52px tool rail on the left, and the fixed
    // 52px icon strip on the right (both permanent chrome, like the topbar)
    // take width off the viewport when the drawer is closed.
    expect(frame!.width).toBeGreaterThanOrEqual(CLOSED_FRAME_MIN_WIDTH);
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test('opening the drawer shows the panel and narrows the chart frame', async ({ page }) => {
    // The toggle lives in the topbar, so the page needs a chart behind the stub, not the setup screen.
    const { pageErrors, consoleErrors } = await gotoWithStub(page);
    const closedWidth = (await page.locator('.chart-frame').boundingBox())!.width;
    const toggle = page.getByLabel('Toggle trade panel');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The dashboard reserves the drawer's space off the panel's own open class.
    await expect(page.locator('main.dashboard')).toHaveCSS('padding-right', OPEN_DASHBOARD_PADDING);
    await expect(page.locator('aside.trade-panel')).toBeVisible();
    const openWidth = await settledFrameWidth(page);
    // Opening adds 396px dashboard padding (330px panel + 14px gap + 52px
    // right strip) — the chart must give up at least 300px of its width.
    expect(closedWidth - openWidth).toBeGreaterThanOrEqual(300);
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test('closing the drawer hides the panel and restores the full-width chart frame', async ({ page }) => {
    const { pageErrors, consoleErrors } = await gotoWithStub(page);
    const closedWidth = (await page.locator('.chart-frame').boundingBox())!.width;
    const toggle = page.getByLabel('Toggle trade panel');
    await toggle.click();
    await expect(page.locator('aside.trade-panel')).toBeVisible();
    await settledFrameWidth(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('aside.trade-panel')).toBeHidden();
    const restoredWidth = await settledFrameWidth(page);
    // Poll-again semantics: the frame comes back to its closed width.
    expect(Math.abs(restoredWidth - closedWidth)).toBeLessThanOrEqual(2);
    // Same closed-state chrome budget as above: section chrome + 14px gap + left rail + right strip.
    expect(restoredWidth).toBeGreaterThanOrEqual(CLOSED_FRAME_MIN_WIDTH);
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

test.describe('portfolio card overflow regression', () => {
  // 690px viewport: the narrow window where the 330px drawer used to clip its
  // position rows at the screen edge (nowrap values sized the row to ~380px).
  test.use({ viewport: { width: 690, height: 620 } });

  test('long index position values wrap and stay inside the drawer', async ({ page }) => {
    const { pageErrors, consoleErrors } = await gotoWithStub(page, {
      responses: {
        get_portfolio_snapshot: {
          accountLogin: '50123456',
          capturedAtMs: STUB_NOW,
          positions: [
            {
              ticket: '1001',
              positionId: '885001',
              symbol: 'NAS100',
              timeMs: STUB_NOW,
              magic: 0,
              side: 'buy',
              volume: '4.00000000',
              priceOpen: '30335.00',
              priceCurrent: '30375.67',
              profit: '80.68',
              swap: '0.00',
              stopLoss: '30355.63',
              takeProfit: '30385.99',
            },
          ],
          orders: [],
        },
      },
    });
    await openTradePanel(page);
    const row = page.locator('.portfolio-row');
    await expect(row).toBeVisible();
    // Neither the row nor the drawer may grow wider than its own box.
    const sizes = await page.evaluate(() => {
      const rowEl = document.querySelector('.portfolio-row') as HTMLElement;
      const panelEl = document.querySelector('.trade-panel') as HTMLElement;
      return {
        rowScroll: rowEl.scrollWidth,
        rowWidth: rowEl.getBoundingClientRect().width,
        panelScroll: panelEl.scrollWidth,
        panelWidth: panelEl.getBoundingClientRect().width,
      };
    });
    expect(sizes.rowScroll).toBeLessThanOrEqual(sizes.rowWidth + 1);
    expect(sizes.panelScroll).toBeLessThanOrEqual(sizes.panelWidth + 1);
    // And no value is ellipsized away — the full string must stay rendered.
    await expect(row).toContainText(
      /P\/L\s*80\.68 USD\s*Price\s*30375\.67\s*SL\s*30355\.63\s*TP\s*30385\.99\s*Swap\s*0\.00 USD/,
    );
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

test('chart chrome nests the connection dot inside the OHLC legend, after its text', async ({ page }) => {
  // The dot belongs to a rendered chart, so load one: a connected stub serves the candles.
  const { consoleErrors } = await gotoWithStub(page);
  await expect(page.locator('.chart-legend')).toHaveAttribute('aria-label', 'Candle OHLC');
  // Exactly two spans, and the dot is the last of them, so the text comes first.
  await expect(page.locator('.chart-legend > span')).toHaveCount(2);
  const dot = page.locator('.chart-legend > span:last-child');
  await expect(dot).toHaveClass(/chart-connection-dot/);
  await expect(dot).toHaveAttribute('role', 'status');
  await expect(dot).toHaveAttribute('aria-label', /^MT5 /);
  // The dot only shows once the stub's candles have rendered a chart.
  await expect(dot).toBeVisible();
  // With candles the waiting state is gone: the chart chrome is back on screen.
  await expectChartChrome(page, 'visible');
  expect(await isTopmostAtCentre(dot)).toBe(true);
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test('the chart paints when the webview reports the invalid language tag "C" (Linux WebKitGTK)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'language', { get: () => 'C' });
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['C'] });
  });
  const { pageErrors } = await gotoWithStub(page);
  await expectChartChrome(page, 'visible');
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test.describe('tool rail', () => {
  test('pointer tools and Fixed range volume profile are the entries; group menu closed by default', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = await gotoWithStub(page);
    const buttons = page.locator('.tool-rail .tool-rail-btn');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'Pointer tools');
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Fixed range volume profile');
    // The pointer group's head shows the active tool — the arrow pointer here.
    await expect(buttons.nth(0)).toHaveClass(/active/);
    await expect(buttons.nth(0).locator('.drawing-tool-icon')).toHaveAttribute('data-icon', 'arrow');
    const arrow = page.locator('.tool-rail-arrow');
    await expect(arrow).toHaveAttribute('aria-expanded', 'false');
    await expect(buttons.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.tool-flyout')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test('Escape cancels the active profile tool and keyboard focus stays accessible', async ({ page }) => {
    const { pageErrors } = await gotoWithStub(page);
    const profile = page.getByRole('button', { name: 'Fixed range volume profile', exact: true });
    const pointer = page.getByRole('button', { name: 'Pointer tools', exact: true });
    await profile.focus();
    await page.keyboard.press('Enter');
    await expect(profile).toHaveClass(/active/);
    await expect(pointer).not.toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(pointer).toHaveClass(/active/);
    expect(pageErrors).toEqual([]);
  });
});

test('the connection dot recovers from a bind error through connecting to connected', async ({ page }) => {
  await gotoWithStub(page);
  const dot = page.locator('.chart-connection-dot');
  await expect(dot).toHaveAttribute('aria-label', 'MT5 connected');
  await pushEvent(page, 'bridge-status', {
    state: 'protocol_error',
    message: 'bridge bind failed: Address already in use; retrying in 1s',
  });
  await expect(dot).toHaveClass(/chart-connection-protocol_error/);
  await expect(dot).toHaveAttribute('title', /retrying in 1s/);
  await pushEvent(page, 'bridge-status', {
    state: 'connecting',
    message: 'Waiting for MT5 bridge to connect.',
  });
  await expect(dot).toHaveAttribute('aria-label', 'MT5 connecting');
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    supportedTimeframes: ['M1'],
    message: 'Bridge connected.',
  });
  await expect(dot).toHaveAttribute('aria-label', 'MT5 connected');
  await expect(dot).toHaveAttribute('title', 'Bridge connected.');
});

test('an outdated MT5 bridge shows the update instructions while waiting for data', async ({ page }) => {
  const message =
    'App requires MT5 bridge version 1.002, but installed bridge version is 0.6.0. Update and reattach BetterChartsBridge in MT5.';
  await gotoWithStub(page, {
    responses: {
      get_bridge_status: { state: 'protocol_error', message },
      get_market_snapshot: { complete: false, candles: [] },
    },
  });
  // No chart yet: the setup screen stands where the chart would be, and the notice keeps the refusal.
  await expect(setupScreen(page)).toBeVisible();
  await expect(page.getByText('Connect MetaTrader 5', { exact: true })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
