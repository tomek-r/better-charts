import { test, expect, type Page } from '@playwright/test';
import { openTradePanel } from './panel';
import type { RenderBar } from '../src/features/chart/engine/mt5DataAdapter';
import {
  gotoWithStub,
  pushCommandError,
  pushCommandUpdate,
  pushEvent,
  STUB_NOW,
  stubInvocations,
  wasInvoked,
} from './tauriStub';

// Execution-flow coverage: the Order panel checklist, the outcome banner, the
// command-status list and the close/cancel dispatch path, driven end-to-end in
// the browser against the stubbed `window.__TAURI_INTERNALS__` (see tauriStub.ts).
// Unlike smoke.spec.ts there is NO tauri/invoke console tolerance here: with the
// stub installed every invoke resolves or rejects in-page (legitimate rejections
// log via console.info), so any console error is a real regression.

function expectClean({ pageErrors, consoleErrors }: { pageErrors: string[]; consoleErrors: string[] }) {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

/** Fills the staged money-sizing draft so a current risk preview becomes valid.
 * Entry is seeded deterministically from the stub quote (1.0850 ask) — the
 * market ticket's price row is disabled, mirroring TradingView. */
async function fillRiskDraft(page: Page) {
  // Stage first (owner flow: the CTA arms only for a staged order).
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  // Anchor on the connected bridge: the ticket-header DEMO badge needs the account snapshot.
  await expect(page.locator('.ticket-title .ticket-account-badge')).toHaveText('DEMO · 50123456');
  // Market order: price row disabled, entry follows the quote.
  const priceInput = page
    .locator('.ticket-row')
    .filter({ has: page.locator('[aria-label="Order price"]') })
    .locator('[aria-label="Order price"]');
  await expect(priceInput).toBeDisabled();
  await expect(priceInput).toHaveValue('1.0850');
  // Changing sizing mode clears the draft. Enter the chosen stop before the
  // budget so the first preview uses that price rather than a seeded default.
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await expect(page.locator('.ticket-mode-indicator')).toContainText('Risk, USD');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await page.getByLabel('Risk amount').fill('25');
  await expect
    .poll(async () => (await wasInvoked(page, 'request_risk_preview'))?.args)
    .toMatchObject({ stopLoss: '1.0800', riskAmount: '25' });
}

/**
 * Draft → accepted OrderCheck: fills the ticket, waits for the reactive
 * risk-preview result, runs "Start creating order" (review stage) and waits
 * for Passed.
 */
/** Page-coordinate geometry of the staged widget (DEV hook window.__stagedWidgetTest). */
interface StagedGeom {
  staged: boolean;
  container: { left: number; top: number; width: number; height: number };
  entryLineY: number | null;
  entryCancel: { x: number; y: number; r: number } | null;
  slCancel: { x: number; y: number; r: number } | null;
  tpCancel: { x: number; y: number; r: number } | null;
  slHandle: { x: number; y: number; w: number; h: number } | null;
  tpHandle: { x: number; y: number; w: number; h: number } | null;
  volume: string | null;
  slMoney: string | null;
  tpMoney: string | null;
  riskRewardLabel: string | null;
  chartRect: { x: number; y: number; width: number; height: number } | null;
  visibleRange: { from: number; to: number } | null;
  priceRange: { min: number; max: number } | null;
  barSpacing: number | null;
  barWidth: number | null;
  digits: number;
  offset: number | null;
  endAnchor: number | null;
  followArmed: boolean | null;
  askY: number | null;
  bidY: number | null;
}
async function stagedGeom(page: Page): Promise<StagedGeom | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __stagedWidgetTest?: { geometry(): unknown } };
    return (w.__stagedWidgetTest?.geometry() as StagedGeom | null) ?? null;
  });
}
/**
 * Drag with a velocity-free tail. The library's drag momentum starts only
 * above 0.1px/ms and synthetic instant moves read as huge velocities, flinging
 * the view a third of a screen past the release point; the extra 1px sample
 * after a pause leaves velocity ≈ 0.02px/ms, so the release lands EXACTLY.
 */
async function dragExact(page: Page, fromX: number, toX: number, y: number): Promise<void> {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.move(toX + 1, y);
  await page.mouse.up();
}
async function chartData(page: Page): Promise<readonly RenderBar[]> {
  return page.evaluate(() => window.__chartTest?.data() ?? []);
}
async function chartRange(page: Page): Promise<{ from: number; to: number } | null> {
  return page.evaluate(() => window.__chartTest?.visibleRange() ?? null);
}
async function setChartRange(page: Page, range: { from: number; to: number }): Promise<void> {
  await page.evaluate((next) => window.__chartTest?.scrollToRange(next), range);
  // Public time-scale updates apply on the next render frame.
  await expect.poll(async () => (await chartRange(page))?.to).toBeCloseTo(range.to, 5);
}
async function candleX(page: Page, timeMs: number): Promise<number> {
  return page.evaluate((time) => {
    // timeToX signals "no coordinate" with NaN, never with null.
    const x = window.__chartTest?.timeToX(time);
    if (x === undefined || Number.isNaN(x)) {
      throw new Error('Real candle has no rendered coordinate');
    }
    return x;
  }, timeMs);
}
async function stagedExpectedPrice(page: Page, clientY: number): Promise<string | null> {
  return page.evaluate((y) => {
    const w = window as unknown as { __stagedWidgetTest?: { expectedPrice(y: number): string | null } };
    return w.__stagedWidgetTest?.expectedPrice(y) ?? null;
  }, clientY);
}
/** Stage the widget via the quote-row Buy button and wait for painted geometry. */
async function stageAndPaint(page: Page): Promise<StagedGeom> {
  const ticket = page.locator('section.order-ticket');
  await ticket.locator('.ticket-quote-side.buy').click();
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  await expect
    .poll(async () => (await stagedGeom(page))?.entryCancel !== null && (await stagedGeom(page))?.chartRect !== null, {
      timeout: 10_000,
    })
    .toBe(true);
  return (await stagedGeom(page))!;
}

/** Click the painted entry (✕) chip until the widget unstages. The chip's page
 *  coordinates come from the LAST paint — a repaint or a late layout shift can
 *  move it before the mouse lands (flaky under parallel load), so re-read the
 *  fresh geometry and retry instead of clicking one stale point. */
async function clickUnstageChip(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const chip = (await stagedGeom(page))?.entryCancel;
    if (!chip) {
      return;
    }
    await page.mouse.click(chip.x, chip.y);
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      if (!(await stagedGeom(page))?.staged) {
        return;
      }
      await page.waitForTimeout(50);
    }
  }
}

async function completeOrderCheck(page: Page) {
  await fillRiskDraft(page);
  const cta = page.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  await expect(page.locator('.order-check-grid')).toBeVisible();
  expect((await wasInvoked(page, 'request_order_check'))?.args).toMatchObject({ volume: '0.10' });
}

test('stubbed runtime connects: sidebar, account badge and chart data render', async ({ page }) => {
  const collected = await gotoWithStub(page);
  // The right panel is a slide-out drawer (closed by default) — open it.
  await openTradePanel(page);
  // Connected bridge replaces the plain-browser fallback.
  await expect(page.locator('aside.trade-panel')).toBeVisible();
  await expect(page.locator('.runtime-label')).toHaveCount(0);
  // Safety surfaces (Execution safety / Recovery journal / Reconciliation / MT5
  // backend cards) were removed from the UI — their data is log-only now.
  await expect(page.locator('.execution-safety-card')).toHaveCount(0);
  await expect(page.locator('.recovery-card')).toHaveCount(0);
  await expect(page.locator('.reconciliation-card')).toHaveCount(0);
  // Account environment badge: DEMO · login, tooltip carries the raw enum + server.
  const badge = page.locator('.ticket-title .ticket-account-badge');
  await expect(badge).toHaveText('DEMO · 50123456');
  await expect(badge).toHaveAttribute('title', 'account_trade_mode=0 · Broker-Demo');
  // The portfolio card lists open positions only, and the default stub snapshot
  // has none, so the panel deliberately renders no card here. The populated case
  // is covered by "portfolio shows positions only" below.
  await expect(page.locator('.portfolio-card')).toHaveCount(0);
  // Stubbed snapshot flows: symbol visible, bars painted (no waiting overlay).
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
  // The Order panel is gone — command lifecycle is log-only now.
  await expect(page.locator('.order-panel-card')).toHaveCount(0);
  await expect(page.locator('.backend-running')).toHaveCount(0);
  // The invocation log proves the app talked to the stub, not a real shell.
  const invoked = (await stubInvocations(page)).map((entry) => entry.cmd);
  for (const cmd of [
    'get_bridge_status',
    'get_market_snapshot',
    'get_account_snapshot',
    'get_execution_safety_status',
    'get_execution_recovery_snapshot',
    'get_execution_queue_status',
    'get_reconciliation_status',
    'plugin:event|listen',
  ]) {
    expect(invoked, `expected invoke log to contain "${cmd}"`).toContain(cmd);
  }
  expectClean(collected);
});

test('command errors notify and lifecycle events remain logged', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const logs: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'info') {
      logs.push(message.text());
    }
  });
  await pushCommandUpdate(page, { commandId: 'cmd-2001', status: 'accepted' });
  await pushCommandUpdate(page, {
    commandId: 'cmd-2001',
    status: 'filled',
    retcode: 10009,
    dealId: '777001',
    positionId: '555001',
    filledVolume: '0.10',
  });
  await pushCommandUpdate(page, {
    commandId: 'cmd-2002',
    status: 'rejected',
    retcode: 10004,
    message: 'Invalid volume: below broker minimum',
  });
  await pushCommandUpdate(page, { commandId: 'cmd-2003', status: 'unknown' });
  await pushCommandError(page, {
    commandId: 'cmd-2004',
    code: 'journal_write_failed',
    message: 'Journal write rejected by disk policy.',
  });
  const updates = () => logs.filter((line) => line.startsWith('[command-update]'));
  const errors = () => logs.filter((line) => line.startsWith('[command-error]'));
  await expect.poll(() => updates().length).toBe(4);
  await expect.poll(() => errors().length).toBe(1);
  // Payload evidence is preserved verbatim in the logs.
  expect(updates()[0]).toContain('"status":"accepted"');
  expect(updates()[1]).toContain('"status":"filled"');
  expect(updates()[1]).toContain('"dealId":"777001"');
  expect(updates()[2]).toContain('"status":"rejected"');
  expect(updates()[2]).toContain('Invalid volume');
  expect(updates()[3]).toContain('"status":"unknown"');
  expect(errors()[0]).toContain('journal_write_failed');
  expect(errors()[0]).toContain('Journal write rejected by disk policy.');
  const notification = page
    .locator('.notification-region [role=alert]')
    .filter({ hasText: 'Journal write rejected by disk policy.' });
  await expect(notification).toBeVisible();
  await notification.getByRole('button', { name: 'Dismiss error notification' }).click();
  await expect(notification).toBeHidden();
  // The Order panel itself is gone from the DOM.
  await expect(page.locator('.order-panel-card')).toHaveCount(0);
  expectClean(collected);
});

test('checklist gates: draft → Start creating order (OrderCheck) → Send order', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await fillRiskDraft(page);
  // Risk preview arrived (reactive event) — the ticket CTA opens the review stage.
  await expect(page.getByLabel('Risk amount')).toHaveValue('25');
  const cta = page.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  // No Send button exists before the review stage: submitting without an
  // accepted OrderCheck is structurally impossible, not just disabled.
  await expect(page.locator('.ticket-cta.send')).toHaveCount(0);
  await cta.click();
  // Review stage: compact OrderCheck result + Send order confirm.
  await expect(page.locator('.order-check-result')).toBeVisible();
  await expect(page.locator('.order-check-grid')).toContainText('1.0850'); // used price echoes entry
  await expect(page.locator('.order-check-grid')).toContainText('1.0800'); // SL value — shown only when selected
  await expect(page.locator('.order-check-grid')).not.toContainText('Take profit'); // TP off ⇒ no TP cell
  const send = page.locator('.ticket-cta.send');
  await expect(send).toBeEnabled();
  // Both reactive invokes were issued with the current draft's data.
  const riskPreview = await wasInvoked(page, 'request_risk_preview');
  expect(riskPreview?.args).toMatchObject({
    symbol: 'EURUSD',
    side: 'buy',
    entry: '1.0850',
    stopLoss: '1.0800',
    riskAmount: '25',
  });
  const orderCheck = await wasInvoked(page, 'request_order_check');
  expect(orderCheck?.args).toMatchObject({
    symbol: 'EURUSD',
    side: 'buy',
    orderKind: 'market',
    volume: '0.10',
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
    limitPrice: null,
    timeInForce: 'gtc',
  });
  expectClean(collected);
});

test('failed OrderCheck surfaces the broker comment verbatim', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    orderCheckResult: {
      checkPassed: false,
      retcode: 10019,
      lastError: 4756,
      comment: 'Not enough money',
      margin: '105.00',
      freeMargin: '4.00',
    },
  });
  await openTradePanel(page);
  await completeOrderCheck(page);
  const reason = page.locator('.notification-region [role=alert]').filter({ hasText: 'Adjust the ticket' });
  await expect(reason).toBeVisible();
  await expect(reason).toContainText('Not enough money');
  await expect(reason).toContainText('code 10019');
  await expect(page.locator('.notification-region [role=alert]')).toHaveCount(1);
  await expect(page.locator('.notification-region [role=alert]')).not.toContainText('Last error code');
  // The broker's margin numbers still render as the quantitative context.
  await expect(page.locator('.order-check-grid')).toContainText('Free margin');
  // A failed check never enables Send.
  await expect(page.locator('.ticket-cta.send')).toBeDisabled();
  expectClean(collected);
});

test('failed OrderCheck without a broker comment falls back to the retcode copy', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    orderCheckResult: { checkPassed: false, retcode: 10019, lastError: 4756, comment: '   ' },
  });
  await openTradePanel(page);
  await completeOrderCheck(page);
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'Adjust the ticket' })).toHaveText(
    'Retcode 10019. Adjust the ticket and start the review again.',
  );
  await expect(page.locator('.notification-region [role=alert]')).toHaveCount(1);
  expectClean(collected);
});

test('submit sends the accepted draft', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await completeOrderCheck(page);
  await page.locator('.ticket-cta.send').click();
  const submit = await wasInvoked(page, 'submit_order');
  expect(submit?.args).toMatchObject({
    draftId: 'draft-001',
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
    symbol: 'EURUSD',
    side: 'buy',
    orderKind: 'market',
    volume: '0.10',
    entry: '1.0850',
    stopLoss: '1.0800',
    takeProfit: null,
    limitPrice: null,
    timeInForce: 'gtc',
  });
  // Owner: a sent order CLOSES the review and resets the ticket to its
  // defaults — no confirmation copy, no stale draft left behind.
  await expect(page.locator('.ticket-review-head')).toHaveCount(0);
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.locator('.units-row .ticket-value')).toHaveValue('1');
  await expect(page.locator('.command-status')).toHaveCount(0);
  await expect(page.locator('.ticket-blocked-reason')).toHaveCount(0);
  expectClean(collected);
});

test('a second order using 1 percent risk keeps its accepted review through equity ticks', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await completeOrderCheck(page);
  await page.locator('.ticket-cta.send').click();
  await expect
    .poll(async () => (await stubInvocations(page)).filter((item) => item.cmd === 'submit_order').length)
    .toBe(1);
  await page.locator('.ticket-quote-side.sell').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  await page.getByLabel('Risk percent').fill('1');
  await page.getByLabel('Stop loss price').fill('1.0900');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args)
    .toMatchObject({ side: 'sell', riskAmount: '100.00', stopLoss: '1.0900' });
  const sizing = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  await pushEvent(page, 'risk-preview', {
    ...sizing.args,
    riskBudget: '100.00',
    volume: '0.40',
    estimatedRisk: '5.75',
    estimatedReward: null,
    estimatedMargin: '9390',
    rr: null,
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$5.75');
  await page.locator('.ticket-cta').click();
  const send = page.locator('.ticket-cta.send');
  await expect(send).toBeEnabled();
  const checked = (await stubInvocations(page)).filter((item) => item.cmd === 'request_order_check').at(-1)!;
  const previewCount = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').length;
  await pushEvent(page, 'account-snapshot', {
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
    currency: 'USD',
    balance: '10000',
    equity: '9998',
    margin: '605',
    freeMargin: '9393',
    marginLevel: '1652.56',
    leverage: 100,
    marginMode: 2,
    tradeAllowed: true,
    expertAllowed: true,
    accountTradeMode: 0,
    accountTradeModeName: 'demo',
  });
  await expect(page.locator('.ticket-review-head')).toBeVisible();
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$5.75');
  await expect(send).toBeEnabled();
  await send.click();
  const submissions = (await stubInvocations(page)).filter((item) => item.cmd === 'submit_order');
  expect(submissions).toHaveLength(2);
  expect(submissions[1].args).toMatchObject({
    side: 'sell',
    volume: checked.args.volume,
    entry: checked.args.entry,
    stopLoss: checked.args.stopLoss,
  });
  expect((await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview')).toHaveLength(
    previewCount,
  );
  expectClean(collected);
});

test('closed market session blocks submission and explains why', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    responses: {
      get_bridge_status: {
        state: 'connected',
        protocolVersion: '2.1',
        terminal: 'MetaTrader 5 (demo)',
        account: '50123456',
        server: 'Broker-Demo',
        lastHeartbeat: STUB_NOW,
        message: 'Bridge connected — market data is flowing.',
        marketSession: { symbol: 'EURUSD', isOpen: false, tradeMode: 4, serverTimeMs: STUB_NOW },
      },
    },
  });
  await openTradePanel(page);
  await completeOrderCheck(page);
  // The accepted OrderCheck still renders, but Send is hard-disabled and the
  // reason names the closed session instead of a stale generic gate.
  const send = page.locator('.ticket-cta.send');
  await expect(send).toBeDisabled();
  await expect(page.locator('.ticket-blocked-reason')).toHaveText(
    'Market is closed for this symbol — trading resumes when the session opens.',
  );
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expectClean(collected);
});

test('submit dispatch-lock rejection is logged and re-enables the button', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    failures: { submit_order: 'Dispatch is disabled by owner policy.' },
  });
  await openTradePanel(page);
  const logs: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'info') {
      logs.push(message.text());
    }
  });
  await completeOrderCheck(page);
  await page.locator('.ticket-cta.send').click();
  await expect.poll(() => logs.some((line) => line.startsWith('[submit-order] rejected'))).toBe(true);
  expect(logs.find((line) => line.startsWith('[submit-order] rejected'))).toContain('Dispatch is disabled');
  // The calm locked line explains the rejection instead of a stale gate reason.
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'Dispatch locked' })).toHaveText(
    'Dispatch locked — nothing was sent to MT5. Owner approval required.',
  );
  // Busy state cleared: the gate recovers instead of sticking on Sending….
  const send = page.locator('.ticket-cta.send');
  await expect(send).toBeEnabled();
  await expect(send).toHaveText('Send order');
  const submit = await wasInvoked(page, 'submit_order');
  expect(submit).toBeDefined();
  expectClean(collected);
});

test('portfolio shows positions only and dispatches close through the stubbed bridge', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    responses: {
      get_portfolio_snapshot: {
        accountLogin: '50123456',
        capturedAtMs: STUB_NOW,
        positions: [
          {
            ticket: '1001',
            positionId: '885001',
            symbol: 'EURUSD',
            timeMs: STUB_NOW,
            magic: 0,
            side: 'buy',
            volume: '0.10',
            priceOpen: '1.0840',
            priceCurrent: '1.0852',
            profit: '1.20',
            swap: '0.00',
            stopLoss: '1.0800',
            takeProfit: '1.0900',
          },
        ],
        orders: [
          {
            orderId: '990001',
            symbol: 'EURUSD',
            timeSetupMs: STUB_NOW,
            magic: 0,
            orderType: 'sell_limit',
            state: 'placed',
            volumeInitial: '0.20',
            volumeCurrent: '0.20',
            priceOpen: '1.0950',
            priceCurrent: '1.0950',
            stopLoss: undefined,
            takeProfit: undefined,
          },
        ],
      },
    },
  });
  await openTradePanel(page);
  const rows = page.locator('.portfolio-row');
  // Owner: pending orders are OUT of the portfolio UI — the stub above still
  // carries one and it must not render (no row, no Cancel action).
  await expect(rows).toHaveCount(1);
  // Account state bar rides with the live position (MT5 layout).
  const account = page.locator('.portfolio-account');
  await expect(account).toContainText('10,000.00 USD');
  await expect(account).toContainText('9,500.00');
  await expect(account).toContainText('2,000.00 %');
  const status = page.locator('.portfolio-card .command-status');
  // Close the position row.
  const closeButton = rows.nth(0).locator('.portfolio-action');
  await expect(closeButton).toHaveText('Close');
  await closeButton.click();
  // Owner: success is SILENT — sync on the recorded invoke, then assert that no
  // confirmation status line ever appears.
  await expect.poll(async () => (await wasInvoked(page, 'close_position')) !== undefined).toBe(true);
  await expect(status).toHaveCount(0);
  const close = await wasInvoked(page, 'close_position');
  expect(close?.args).toMatchObject({
    positionId: '885001',
    volume: null,
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
  });
  // Owner: pending orders never render — no Cancel action can fire from the list.
  expect(await wasInvoked(page, 'cancel_order')).toBeUndefined();
  expectClean(collected);
});

test('clicking a position row opens that symbol on the chart', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_portfolio_snapshot: {
        accountLogin: '50123456',
        capturedAtMs: STUB_NOW,
        positions: [
          {
            ticket: '2001',
            positionId: '885002',
            symbol: 'GBPUSD',
            timeMs: STUB_NOW,
            magic: 0,
            side: 'sell',
            volume: '0.20',
            priceOpen: '1.2700',
            priceCurrent: '1.2690',
            profit: '2.00',
            swap: '0.00',
            stopLoss: '1.2750',
            takeProfit: '1.2600',
          },
        ],
        orders: [],
      },
    },
  });
  await openTradePanel(page);
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await page.locator('.portfolio-open').first().click();
  await expect.poll(async () => page.locator('.chart-heading h1').textContent()).toBe('GBPUSD');
  const historyRequests = (await stubInvocations(page)).filter((item) => item.cmd === 'request_history').length;
  await page.locator('.portfolio-open').first().click();
  expect((await stubInvocations(page)).filter((item) => item.cmd === 'request_history')).toHaveLength(historyRequests);
  await expect(page.locator('.chart-heading h1')).toHaveText('GBPUSD');
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
  // The row body is the open action; Close is a separate button and must not
  // have fired a close when the open area was clicked.
  expect(await wasInvoked(page, 'close_position')).toBeUndefined();
});

// NOTE: the draft-modification card (`.draft-modification-card` / "Confirm
// close") was removed by the owner, so there is no panel confirm UI to cover
// here: `pendingModification` is only ever created by OUR chart interactions —
// SL/TP/order-price drags on the custom position overlay (positionModify /
// orderModify handlers in App.tsx) — not by any Tauri event or invoke the stub
// can push. (The old positionClose/orderCancel chart handlers were dead code —
// the library never emitted those events — and were replaced by the overlay's
// ✕ chips, which call requestClosePosition/requestCancelOrder directly.)
// Reaching the card from a test would require driving those canvas gestures —
// see the report note instead of adding selectors to src/.

test('Stop Limit + TIF are wired to the ready backend', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  // Draft the market baseline first (price row disabled for market).
  await fillRiskDraft(page);
  await expect(page.getByLabel('Risk amount')).toHaveValue('25');
  // Stop Limit tab is ENABLED; activating it adds the Limit price row and the
  // price row relabels to "Trigger price".
  const stopLimit = ticket.locator('.ticket-type-tab', { hasText: 'Stop Limit' });
  await expect(stopLimit).toBeEnabled();
  await stopLimit.click();
  await expect(stopLimit).toHaveAttribute('aria-pressed', 'true');
  await expect(ticket.locator('.ticket-row-label', { hasText: 'Trigger price' })).toBeVisible();
  const limitInput = page.getByLabel('Limit price');
  await expect(limitInput).toBeVisible();
  // Check is BLOCKED without a limit price — and per the no-hints policy the
  // disabled CTA explains nothing (no reason line renders at all).
  const cta = page.locator('.ticket-cta');
  await expect(cta).toBeDisabled();
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'Adjust the ticket' })).toHaveCount(
    0,
  );
  await limitInput.fill('1.0860');
  await expect(cta).toBeEnabled();
  // TIF select: enabled, 4 options, default GTC; picking IOC lands in the args.
  await ticket.locator('.ticket-collapse-head', { hasText: 'Extra settings' }).click();
  const tif = page.locator('[aria-label="Time in force"]');
  await expect(tif).toBeEnabled();
  await expect(tif.locator('option')).toHaveCount(4);
  await expect(tif).toHaveValue('gtc');
  await tif.selectOption('ioc');
  await expect(tif).toHaveValue('ioc');
  // Preflight + send carry stop_limit, limitPrice and timeInForce.
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  await expect(page.locator('.order-check-grid')).toBeVisible();
  const check = await wasInvoked(page, 'request_order_check');
  expect(check?.args).toMatchObject({
    orderKind: 'stop_limit',
    limitPrice: '1.0860',
    timeInForce: 'ioc',
    entry: '1.0850',
    stopLoss: '1.0800',
    volume: '0.10',
  });
  await page.locator('.ticket-cta.send').click();
  const submit = await wasInvoked(page, 'submit_order');
  expect(submit?.args).toMatchObject({
    orderKind: 'stop_limit',
    limitPrice: '1.0860',
    timeInForce: 'ioc',
    stopLoss: '1.0800',
    takeProfit: null,
  });
  expectClean(collected);
});

test('staged-order widget: Sell/Buy stages the chart chip, ✕ unstages, nothing dispatched', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  // Staging starts clean (panel has no staged chip — the chart widget owns it).
  await expect.poll(async () => (await stagedGeom(page))?.staged ?? false, { timeout: 10_000 }).toBe(false);
  // Quote-row Sell = side select + stage (widget paints on the chart canvas;
  // here we pin the ticket-side lifecycle only — internals are chart-free).
  const sell = ticket.locator('.ticket-quote-side.sell');
  await sell.click();
  await expect(sell).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // Buy re-stages with the other side.
  const buy = ticket.locator('.ticket-quote-side.buy');
  await buy.click();
  await expect(buy).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // The painted (✕) chip on the chart unstages everything.
  await expect.poll(async () => (await stagedGeom(page))?.entryCancel != null, { timeout: 10_000 }).toBe(true);
  await clickUnstageChip(page);
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(false);
  // Staging never dispatches: no order-check / submit from quote-row clicks.
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
  expectClean(collected);
});

// ── Canvas-gesture coverage: REAL pointer gestures on the chart, asserting
// only TICKET-side effects (chart-assertion-free rule). Geometry comes from the
// DEV-only window.__stagedWidgetTest hook, which reports painted positions in
// page coordinates — so these tests fail if the handler's coordinate frame ever
// drifts from the paint frame again (the dead-interaction root cause).

test('canvas gesture: dragging the staged SL handle flips the SL toggle on and writes the exact price', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const g = await stageAndPaint(page);
  // Starts from SL OFF (owner default) so the flip is observable on drag.
  const slToggle = page.getByLabel('Stop loss enabled');
  await expect(slToggle).not.toBeChecked();
  // Floating SL handle sits above the entry line while unset — grab its CENTER.
  await expect.poll(async () => (await stagedGeom(page))?.slHandle !== null, { timeout: 10_000 }).toBe(true);
  const handle = (await stagedGeom(page))!.slHandle!;
  const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  const dropY = start.y + 60;
  // Exact ticket value the drop must produce (same clamp/transform/round chain).
  const expected = await stagedExpectedPrice(page, dropY);
  expect(expected).toBeTruthy();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, dropY, { steps: 8 });
  await page.mouse.up();
  // Ticket-side effects: toggle flipped ON, Stop-loss row carries the price.
  await expect(slToggle).toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue(expected!);
  // Entry untouched by an SL drag; nothing was dispatched by staging+dragging.
  await expect(page.getByLabel('Order price')).toHaveValue('1.0850');
  await expect.poll(async () => (await stagedGeom(page))?.staged).toBe(true);
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
  void g;
  expectClean(collected);
});

test('canvas gesture: clicking the painted (\u2715) chip on the entry line unstages without dispatch', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const g = await stageAndPaint(page);
  expect(g.staged).toBe(true);
  expect(g.entryCancel).not.toBeNull();
  // Click EXACTLY where the chip was painted — the old host-frame hit test
  // missed painted targets by the widget-chrome offset (+41, +45)px.
  await clickUnstageChip(page);
  // The DOM chip no longer exists (chart owns the cancel) — the geometry helper
  // is the source of truth: the painted (✕) click must unstage the widget.
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(false);
  // Unstaging never dispatches.
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
  expectClean(collected);
});

test('canvas sanity: empty-space drag pans and wheel zooms while staged; widget only swallows its own targets', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const g = await stageAndPaint(page);
  expect(g.priceRange).not.toBeNull();
  const before = { priceRange: g.priceRange!, barWidth: g.barWidth!, visibleRange: g.visibleRange! };
  // Empty space: right-of-center, well below the entry line (out of the \u00b16px
  // line band) and far from the left-side handles/chips.
  const x = g.chartRect!.x + g.chartRect!.width * 0.7;
  let y = g.entryLineY! + 100;
  if (y > g.chartRect!.y + g.chartRect!.height - 10) {
    y = g.chartRect!.y + 30;
  }
  // Diagonal drag must reach the CHART (we did not swallow it): the package's
  // pan requires a horizontal component to move price, so go diagonal and
  // accept EITHER viewport axis moving as proof the event was not intercepted.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y + 70, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const g2 = await stagedGeom(page);
        const pr = g2?.priceRange;
        const vr = g2?.visibleRange;
        const priceMoved =
          pr !== null && pr !== undefined && (pr.min !== before.priceRange.min || pr.max !== before.priceRange.max);
        const rangeMoved =
          vr !== null && vr !== undefined && (vr.from !== before.visibleRange.from || vr.to !== before.visibleRange.to);
        return priceMoved || rangeMoved;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // Wheel zoom also reaches the chart → bar spacing changes.
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 200); // zoom OUT: zoom() clamps at maxBarWidth, 10 stub bars sit there
  await expect
    .poll(
      async () => {
        const now = (await stagedGeom(page))?.barWidth;
        return now !== null && now !== undefined && now !== before.barWidth;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // Through all of that the widget stayed staged and the market ticket price
  // never moved (only real grabs may write ticket fields).
  await expect.poll(async () => (await stagedGeom(page))?.staged).toBe(true);
  await expect(page.getByLabel('Order price')).toHaveValue('1.0850');
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expectClean(collected);
});

test('units menu: ONE input rebinds per mode; TV menu opens from label and indicator, closes on select/outside/Escape', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  // The separate budget row is GONE — exactly one value input in the row.
  await expect(ticket.getByLabel('Risk budget')).toHaveCount(0);
  await expect(ticket.locator('.units-row .ticket-value')).toHaveCount(1);
  // Default mode = UNITS (owner): the one input is bound as the volume field.
  await expect(ticket.getByLabel('Units')).toHaveCount(1);
  // Menu from the "Units ⌄" LABEL: 3 items, Units selected first, (i) tooltips.
  const label = ticket.locator('.ticket-menu-trigger');
  await label.click();
  const menu = ticket.locator('.ticket-menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitemradio');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true'); // Units selected (TV screenshot)
  await expect(items.nth(0)).toContainText('Units');
  await expect(items.nth(0)).toHaveClass(/selected/);
  await expect(menu.locator('.ticket-menu-info')).toHaveCount(3);
  await expect(menu.locator('.ticket-menu-info').first()).toHaveAttribute('title', 'Manually set volume in lots');
  // Escape closes and returns focus to the trigger (keyboard accessibility).
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(label).toBeFocused();
  // The in-field indicator opens the SAME menu; outside click closes it.
  await ticket.locator('.ticket-mode-indicator').click();
  await expect(ticket.locator('.ticket-menu')).toBeVisible();
  await ticket.locator('.ticket-title').click(); // inert, outside the menu
  await expect(ticket.locator('.ticket-menu')).toHaveCount(0);
  // Escape also cancels a staged draft, so stage after the menu keyboard checks.
  await ticket.locator('.ticket-quote-side.buy').click();
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // A mode change clears the amount, manual volume, and both exits.
  await page.getByLabel('Units').fill('0.35');
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  await label.click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await expect(ticket.locator('.ticket-menu')).toHaveCount(0);
  await expect(ticket.getByLabel('Risk amount')).toHaveCount(1);
  await expect(ticket.locator('.ticket-mode-indicator')).toContainText('Risk, USD');
  await expect(ticket.getByLabel('Risk amount')).toHaveValue('');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');

  // A positive risk amount seeds SL only after the mode is selected and the
  // draft is staged; selecting the mode alone leaves the exits untouched.
  await page.getByLabel('Risk amount').fill('25');
  await expect(page.getByLabel('Stop loss enabled')).toBeChecked();
  await expect(page.getByLabel('Stop loss price')).not.toHaveValue('');
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');

  // Switching back clears the risk amount and exits and restores default units.
  await label.click();
  await ticket.getByRole('menuitemradio', { name: 'Units' }).click();
  await expect(ticket.getByLabel('Units')).toHaveCount(1);
  await expect(ticket.getByLabel('Units')).toHaveValue('1');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');

  // Selecting the already active mode preserves its manual value and exits.
  await ticket.getByLabel('Units').fill('0.37');
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  await label.click();
  await expect(ticket.getByRole('menuitemradio', { name: 'Units' })).toBeEnabled();
  await ticket.getByRole('menuitemradio', { name: 'Units' }).click();
  await expect(ticket.locator('.ticket-menu')).toHaveCount(0);
  await expect(ticket.getByLabel('Units')).toHaveValue('0.37');
  await expect(page.getByLabel('Stop loss enabled')).toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.0800');
  await expect(page.getByLabel('Take profit enabled')).toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('1.0900');

  // Changing modes again clears that manual draft and does not retain budget.
  await label.click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await expect(ticket.getByLabel('Risk amount')).toHaveValue('');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');
  // Mode selection alone never enables SL; entering a positive amount does.
  await page.getByLabel('Risk amount').fill('25');
  await expect(page.getByLabel('Stop loss enabled')).toBeChecked();

  // Changing from money to equity starts a separate sizing draft: the dollar
  // amount and both exits are cleared rather than reinterpreted as a percent.
  await label.click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  await expect(ticket.locator('.ticket-mode-indicator')).toContainText('Risk, % equity');
  await expect(ticket.getByLabel('Risk percent')).toHaveValue('');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');
  await page.getByLabel('Risk percent').fill('1');
  await expect(page.getByLabel('Stop loss enabled')).toBeChecked();
  const entryPrice = Number(await page.getByLabel('Order price').inputValue());
  const seeded = Number(await page.getByLabel('Stop loss price').inputValue());
  expect(Number.isFinite(seeded)).toBe(true);
  expect(seeded).toBeGreaterThan(0);
  expect(seeded).toBeLessThan(entryPrice);
  expectClean(collected);
});

test('no-SL flow: SL off + units sizing → Check enabled → Send with stopLoss: null', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  // Stage first (owner flow: the CTA arms only for a staged order).
  await ticket.locator('.ticket-quote-side.buy').click();
  // Units sizing first (SL still on), then drop the stop loss.
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Units' }).click();
  await expect(ticket.locator('.ticket-mode-indicator')).toContainText('Units');
  await page.getByLabel('Stop loss enabled').uncheck();
  // The old FALSE preflight message is gone; the honest no-SL notice shows.
  await expect(page.getByText('Stop loss is required by the MT5 preflight')).toHaveCount(0);
  // Market entry is quote-seeded; enter manual units (no budget needed — the
  // preview cannot exist without SL and the chain runs on the check echo).
  await expect(page.getByLabel('Order price')).toHaveValue('1.0850');
  await page.getByLabel('Units').fill('0.20');
  // P1 pin: Check CTA is ENABLED with SL off.
  const cta = page.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  await expect(page.locator('.order-check-grid')).toBeVisible();
  // SL/TP cells appear only when the exit is selected — here neither is.
  await expect(page.locator('.order-check-grid')).not.toContainText('Stop loss');
  await expect(page.locator('.order-check-grid')).not.toContainText('Take profit');
  const check = await wasInvoked(page, 'request_order_check');
  expect(check?.args).toMatchObject({
    entry: '1.0850',
    stopLoss: null,
    takeProfit: null,
    volume: '0.20',
    timeInForce: 'gtc',
    limitPrice: null,
  });
  // Send dispatches with stopLoss: null (backend SL-optional, a58ad9e).
  await page.locator('.ticket-cta.send').click();
  const submit = await wasInvoked(page, 'submit_order');
  expect(submit?.args).toMatchObject({ stopLoss: null, takeProfit: null, volume: '0.20', entry: '1.0850' });
  expectClean(collected);
});

test('timeframe switch issues exactly one request_history', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
  const count = async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length;
  // Bootstrap refreshes history and instrument metadata once; record that baseline.
  const before = await count();
  // Switching selection starts one deduplicated history request.
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText('1m');
  await expect.poll(count, { timeout: 10_000 }).toBe(before + 1);
  expectClean(collected);
});

// FRVP lifecycle: the fixed-range selection is TIME-anchored, so a TIMEFRAME
// switch must keep it (selection + drawing + computed profile) while a SYMBOL
// switch — the profile is instrument-specific — must clear all three.
test('fixed range volume profile survives a timeframe switch and clears on a symbol switch (owner)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const item = (symbol: string, description: string, digits: number) => ({
      symbol,
      description,
      digits,
      tickSize: '0.00001',
      pointSize: '0.00001',
      contractSize: '100000',
      volumeMin: '0.01',
      volumeMax: '100',
      volumeStep: '0.01',
      stopsLevel: 0,
      freezeLevel: 0,
      fillingMode: 0,
      orderMode: 0,
      expirationMode: 0,
      tradeExecution: 0,
      tradeMode: 0,
    });
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([item('NAS100', 'US Tech 100', 2)]));
  });
  const collected = await gotoWithStub(page);
  type FrvpState = { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
  const profileState = async () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __stagedWidgetTest?: {
          fixedRangeProfile(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
        };
      };
      return w.__stagedWidgetTest?.fixedRangeProfile() ?? null;
    });
  // The stub ships no profile backend — deliver each observed request_tick_profile
  // as the matching `tick-profile` event (echoed args, like the reactive stubs),
  // so a profile exists to lose. One delivery per invocation, oldest first.
  let delivered = 0;
  const deliverProfiles = async () => {
    const requests = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_tick_profile');
    for (; delivered < requests.length; delivered += 1) {
      const request = requests[delivered];
      await pushEvent(page, 'tick-profile', {
        symbol: request.args.symbol,
        fromMs: request.args.fromMs,
        endMs: request.args.endMs,
        complete: true,
        rejectedTicks: 0,
        actualRows: 2,
        totalWeight: 4,
        poc: '1.0850',
        vah: '1.0855',
        val: '1.0845',
        bidLevels: null,
        askLevels: null,
        bins: [
          { low: '1.0845', high: '1.0850', total: '2', bid: '1', ask: '1' },
          { low: '1.0850', high: '1.0855', total: '2', bid: '1', ask: '1' },
        ],
      });
    }
  };
  /** Answer pending requests until a selection AND its profile are present. */
  const settleProfile = async (): Promise<FrvpState> => {
    await expect
      .poll(
        async () => {
          await deliverProfiles();
          const state = await profileState();
          return state !== null && state.range !== null && state.hasProfile;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    return (await profileState())!;
  };
  // Stub series ON the chart before arming the drawing tool.
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  // Arm FRVP and select two real candle centers.
  const frvpButton = page.locator('.tool-rail button[aria-label="Fixed range volume profile"]');
  await frvpButton.click();
  await expect(frvpButton).toHaveClass(/active/);
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.click(host.x + (await candleX(page, STUB_NOW - 8 * 300_000)), host.y + host.height * 0.35);
  await page.mouse.click(host.x + (await candleX(page, STUB_NOW - 3 * 300_000)), host.y + host.height * 0.35);
  // Placing the drawing released the tool and issued the profile request.
  await expect(page.locator('.tool-rail button[aria-label="Pointer tools"]')).toHaveClass(/active/, { timeout: 5_000 });
  const beforeTimeframe = await settleProfile();
  expect(beforeTimeframe.range).not.toBeNull();
  // TIMEFRAME switch: selection + drawing + profile must ALL survive.
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText('1m');
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  const profileRequests = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_tick_profile').length;
  await page.waitForTimeout(250);
  const afterTimeframe = await settleProfile();
  expect((await stubInvocations(page)).filter((entry) => entry.cmd === 'request_tick_profile')).toHaveLength(
    profileRequests,
  );
  expect(afterTimeframe.range).toEqual(beforeTimeframe.range);
  expect(afterTimeframe.hasProfile).toBe(true);
  // SYMBOL switch: the instrument-specific selection and profile are cleared.
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await page.locator('.search-result-row button', { hasText: 'NAS100' }).click();
  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100', { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const state = await profileState();
        return state !== null && state.range === null && !state.hasProfile;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expectClean(collected);
});

test('canvas gesture: cancelling the staged widget RESETS the SL/TP draft — no stale levels on re-stage (owner)', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await stageAndPaint(page);
  // Set SL by dragging the floating SL handle (flips the toggle, writes a price)…
  const slToggle = page.getByLabel('Stop loss enabled');
  await expect.poll(async () => (await stagedGeom(page))?.slHandle !== null, { timeout: 10_000 }).toBe(true);
  const handle = (await stagedGeom(page))!.slHandle!;
  const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(slToggle).toBeChecked();
  await expect(page.getByLabel('Stop loss price')).not.toHaveValue('');
  // …and TP through the ticket (same state the widget mirrors).
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  // (✕) on the chart = cancel: the draft must NOT survive into the next stage.
  await clickUnstageChip(page);
  await expect.poll(async () => (await stagedGeom(page))?.staged).toBe(false);
  await expect(slToggle).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');
  // Re-staging paints a CLEAN widget: floating handles, no level chips.
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await stagedGeom(page))?.slHandle !== null, { timeout: 10_000 }).toBe(true);
  const again = (await stagedGeom(page))!;
  expect(again.slCancel).toBeNull();
  expect(again.tpCancel).toBeNull();
  expect(again.tpHandle).not.toBeNull();
  // Cancel never dispatched anything.
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
  expectClean(collected);
});

test('canvas gesture: switching side (Buy→Sell / Sell→Buy) starts a fresh draft — no stale SL/TP (owner)', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await stageAndPaint(page);
  // Fill the buy draft: SL via the ticket, TP via the ticket (same mirrored state).
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  // Switch side: Sell must start FRESH — SL/TP levels and toggles cleared.
  const sell = ticket.locator('.ticket-quote-side.sell');
  await sell.click();
  await expect(sell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit price')).toHaveValue('');
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await stagedGeom(page))?.slHandle !== null, { timeout: 10_000 }).toBe(true);
  const onSell = (await stagedGeom(page))!;
  expect(onSell.slCancel).toBeNull();
  expect(onSell.tpCancel).toBeNull();
  // …and back the other way: sell's levels must not leak into the buy draft.
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0900');
  const buy = ticket.locator('.ticket-quote-side.buy');
  await buy.click();
  await expect(buy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('');
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // Nothing was dispatched by staging or switching.
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
  expectClean(collected);
});

test('risk sizing seeds a valid stop, then rejects previews for an invalid stop distance (owner)', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await ticket.locator('.ticket-quote-side.buy').click();
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // Real instrument metadata (the stub ships none) → the stop-distance guard is
  // ACTIVE: EURUSD-like sizes, required minimum = 20 ticks = 20 pts.
  await pushEvent(page, 'symbol-info', {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar',
    digits: 5,
    tickSize: '0.00001',
    pointSize: '0.00001',
    contractSize: '100000',
    volumeMin: '0.01',
    volumeMax: '100',
    volumeStep: '0.01',
    stopsLevel: 0,
    freezeLevel: 0,
    fillingMode: 0,
    orderMode: 0,
    expirationMode: 0,
    tradeExecution: 0,
    tradeMode: 0,
  });
  // Select the sizing basis first. The mode alone must not turn SL on or seed a
  // price; the positive budget below does that for the staged draft.
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Swap Stop loss input to price').click();
  await page.getByLabel('Risk amount').fill('25');
  // BUY stop below the BID (1.0846), with the minimum-distance margin:
  // positive risk budget seeds exactly 1.08438.
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.08438');
  const previewCount = async () =>
    (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_risk_preview').length;
  await expect.poll(previewCount).toBeGreaterThan(0);
  const validPreviewCount = await previewCount();

  // Now put the stop inside the spread. The guard must suppress later preview
  // requests; an earlier valid preview is expected and is not counted as one.
  await page.getByLabel('Stop loss price').fill('1.0847');
  // Risk preview requests are debounced by 100 ms; allow the full debounce and
  // event turn before checking that the invalid stop added no request.
  await page.waitForTimeout(250);
  await expect.poll(previewCount).toBe(validPreviewCount);
  await expect(ticket.getByLabel('Risk amount')).toHaveValue('25');
  expectClean(collected);
});

test('chart handles show the money at SL/TP in the account currency — only when the level is set (owner)', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await ticket.locator('.ticket-quote-side.buy').click();
  await expect.poll(async () => (await stagedGeom(page))?.staged, { timeout: 10_000 }).toBe(true);
  // Instrument metadata: contract 100000, account currency USD (the stub) —
  // entry 1.0850 (market buy) × volume 1 makes the math deterministic.
  await pushEvent(page, 'symbol-info', {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar',
    digits: 5,
    tickSize: '0.00001',
    pointSize: '0.00001',
    contractSize: '100000',
    volumeMin: '0.01',
    volumeMax: '100',
    volumeStep: '0.01',
    stopsLevel: 0,
    freezeLevel: 0,
    fillingMode: 0,
    orderMode: 0,
    expirationMode: 0,
    tradeExecution: 0,
    tradeMode: 0,
  });
  // No levels set → both floating handles keep the plain SL/TP label.
  const g = (await stagedGeom(page))!;
  expect(g.slMoney).toBeNull();
  expect(g.tpMoney).toBeNull();
  // SL only: the SL handle shows the signed money, TP stays silent.
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Swap Stop loss input to price').click();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$500');
  expect((await stagedGeom(page))!.tpMoney).toBeNull();
  // TP set too: gain in the account currency.
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Swap Take profit input to price').click();
  await page.getByLabel('Take profit price').fill('1.0950');
  await expect.poll(async () => (await stagedGeom(page))?.tpMoney).toBe('+$1,000');
  // Turning a level OFF hides its money again.
  await page.getByLabel('Stop loss enabled').uncheck();
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBeNull();
  expectClean(collected);
});

test('live bar updates preserve a panned viewport and following resumes near the latest candle', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  const initial = (await chartRange(page))!;
  const away = { from: initial.from - 10, to: initial.to - 10 };
  await setChartRange(page, away);
  await pushEvent(page, 'bar-update', {
    timeMs: STUB_NOW,
    open: '1.0850',
    high: '1.0855',
    low: '1.0845',
    close: '1.0852',
    tickVolume: 12,
    spread: 2,
    realVolume: 0,
  });
  await expect.poll(async () => (await chartData(page)).length).toBe(11);
  expect((await chartRange(page))!.from).toBeCloseTo(away.from, 5);
  expect((await chartRange(page))!.to).toBeCloseTo(away.to, 5);
  // Latest real candle 10 + the five-bar end margin restores following.
  await setChartRange(page, { from: initial.from + 1, to: initial.to + 1 });
  const following = (await chartRange(page))!;
  await pushEvent(page, 'bar-update', {
    timeMs: STUB_NOW + 300_000,
    open: '1.0852',
    high: '1.0858',
    low: '1.0850',
    close: '1.0855',
    tickVolume: 9,
    spread: 2,
    realVolume: 0,
  });
  await expect.poll(async () => (await chartData(page)).length).toBe(12);
  await expect.poll(async () => (await chartRange(page))!.to).toBeCloseTo(following.to + 1, 5);
  expectClean(collected);
});

test('real panning can move every candle beyond the left edge and realtime keeps that view', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  const rect = (await page.locator('.chart-host').boundingBox())!;
  const y = rect.y + rect.height * 0.5;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await chartRange(page))!.from > 12) {
      break;
    }
    await dragExact(page, rect.x + rect.width * 0.85, rect.x + rect.width * 0.15, y);
  }
  await expect.poll(async () => (await chartRange(page))?.from ?? -1).toBeGreaterThan(12);
  const parked = (await chartRange(page))!;
  await pushEvent(page, 'bar-update', {
    timeMs: STUB_NOW + 300_000,
    open: '1.0852',
    high: '1.0858',
    low: '1.0850',
    close: '1.0855',
    tickVolume: 9,
    spread: 2,
    realVolume: 0,
  });
  await expect.poll(async () => (await chartData(page)).length).toBe(11);
  const after = (await chartRange(page))!;
  expect(after.from).toBeGreaterThan(10);
  expect(after.from).toBeCloseTo(parked.from, 5);
  expect(after.to).toBeCloseTo(parked.to, 5);
  expectClean(collected);
});

test('updates inside the follow zone preserve distance from the five-bar end anchor', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length).toBe(10);
  const initial = (await chartRange(page))!;
  const parked = { from: initial.from + 3, to: initial.to + 3 };
  await setChartRange(page, parked);
  await pushEvent(page, 'bar-update', {
    timeMs: STUB_NOW - 300_000,
    open: '1.0851',
    high: '1.0856',
    low: '1.0847',
    close: '1.0853',
    tickVolume: 7,
    spread: 2,
    realVolume: 0,
  });
  await expect.poll(async () => (await chartData(page)).at(-1)?.close).toBe(1.0853);
  expect((await chartRange(page))!.to).toBeCloseTo(parked.to, 5);
  await pushEvent(page, 'bar-update', {
    timeMs: STUB_NOW,
    open: '1.0853',
    high: '1.0857',
    low: '1.0851',
    close: '1.0854',
    tickVolume: 5,
    spread: 2,
    realVolume: 0,
  });
  await expect.poll(async () => (await chartData(page)).length).toBe(11);
  await expect.poll(async () => (await chartRange(page))!.to).toBeCloseTo(parked.to + 1, 5);
  expectClean(collected);
});

test('price lines: live bid AND ask lines, ask above bid (owner, CFD)', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  await pushEvent(page, 'quote-update', {
    symbol: 'EURUSD',
    timeMs: STUB_NOW,
    bid: '1.0851',
    ask: '1.0853',
    last: '1.0852',
    volume: '2',
    volumeReal: '2',
    flags: 0,
  });
  await expect.poll(async () => (await stagedGeom(page))?.askY ?? null, { timeout: 10_000 }).not.toBeNull();
  const narrow = (await stagedGeom(page))!;
  expect(narrow.bidY).not.toBeNull();
  // The ASK is the buy price and sits ABOVE the bid — same order as the
  // Buy/Sell rows.
  expect(narrow.askY!).toBeLessThan(narrow.bidY!);
  // A wider spread separates the lines further (they track the quotes live).
  await pushEvent(page, 'quote-update', {
    symbol: 'EURUSD',
    timeMs: STUB_NOW,
    bid: '1.0845',
    ask: '1.0861',
    last: '1.0853',
    volume: '2',
    volumeReal: '2',
    flags: 0,
  });
  await expect
    .poll(
      async () => {
        const g = (await stagedGeom(page))!;
        return g.bidY! - g.askY!;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(narrow.bidY! - narrow.askY!);
  expectClean(collected);
});

test('symbol switch re-fits the price scale — the previous ticker scale must not survive (owner)', async ({ page }) => {
  await page.addInitScript(() => {
    const item = (symbol: string, description: string, digits: number) => ({
      symbol,
      description,
      digits,
      tickSize: '0.00001',
      pointSize: '0.00001',
      contractSize: '100000',
      volumeMin: '0.01',
      volumeMax: '100',
      volumeStep: '0.01',
      stopsLevel: 0,
      freezeLevel: 0,
      fillingMode: 0,
      orderMode: 0,
      expirationMode: 0,
      tradeExecution: 0,
      tradeMode: 0,
    });
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([item('NAS100', 'US Tech 100', 2)]));
  });
  const collected = await gotoWithStub(page);
  const range = async () => (await stagedGeom(page))?.priceRange ?? null;
  // Wait for the stub series to be ON the chart (10 bars) before pinning the
  // fitted scale — an empty chart has a default priceRange too.
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  await expect.poll(async () => (await range()) !== null, { timeout: 10_000 }).toBe(true);
  const fitted = (await range())!;
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.chart-host');
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // Drag the public right price scale to establish a manual scale.
  await page.mouse.move(rect.x + rect.w - 15, rect.y + rect.h * 0.4);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.w - 15, rect.y + rect.h * 0.7, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const r = await range();
        return r ? Math.abs(r.min - fitted.min) > 1e-7 || Math.abs(r.max - fitted.max) > 1e-7 : false;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  // Switch symbol via the favorites row (the stub has no search backend).
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await page.locator('.search-result-row button', { hasText: 'NAS100' }).click();
  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100', { timeout: 10_000 });
  // The new series must get a REFIT scale: NAS100 data (stub series at ~30432)
  // on a NAS100 scale — never the previous ticker's ~1.085 scale.
  await expect
    .poll(
      async () => {
        const r = await range();
        return r ? r.min > 30_000 && r.max > 30_000 : false;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expectClean(collected);
});

test('Risk, USD sizing must not break the chart scale after a symbol switch (owner)', async ({ page }) => {
  await page.addInitScript(() => {
    const item = (symbol: string, description: string, digits: number) => ({
      symbol,
      description,
      digits,
      tickSize: '0.00001',
      pointSize: '0.00001',
      contractSize: '100000',
      volumeMin: '0.01',
      volumeMax: '100',
      volumeStep: '0.01',
      stopsLevel: 0,
      freezeLevel: 0,
      fillingMode: 0,
      orderMode: 0,
      expirationMode: 0,
      tradeExecution: 0,
      tradeMode: 0,
    });
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([item('NAS100', 'US Tech 100', 2)]));
  });
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const range = async () => (await stagedGeom(page))?.priceRange ?? null;
  await expect.poll(async () => (await chartData(page)).length, { timeout: 10_000 }).toBe(10);
  // Switch to the NAS100 series (stub candles at ~30432) and wait for the refit.
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await page.locator('.search-result-row button', { hasText: 'NAS100' }).click();
  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100', { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const r = await range();
        return r ? r.min > 30_000 && r.max > 30_000 : false;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // Stage and pick Risk, USD: the sizing-mode reset must preserve the chart scale.
  const ticket = page.locator('section.order-ticket');
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await page.waitForTimeout(800);
  // The scale must STILL fit the NAS100 series — no stale/foreign scale and no
  // collapsed view (owner: 'jak wlaczam opcje risk, usd to sie pojawia na
  // wykresie' — the chart broke on mode select).
  const after = await range();
  expect(after).not.toBeNull();
  expect(after!.min).toBeGreaterThan(30_000);
  expect(after!.max).toBeGreaterThan(30_000);
  expectClean(collected);
});

test('pending risk sizing keeps loss and reward based on actual volume', async ({ page }) => {
  const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
  await openTradePanel(page);
  await fillRiskDraft(page);
  await pushEvent(page, 'symbol-info', {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar',
    digits: 4,
    tickSize: '0.0001',
    pointSize: '0.0001',
    contractSize: '2750',
    volumeMin: '0.01',
    volumeMax: '100',
    volumeStep: '0.01',
    stopsLevel: 0,
    freezeLevel: 0,
    fillingMode: 0,
    orderMode: 0,
    expirationMode: 0,
    tradeExecution: 0,
    tradeMode: 0,
  });
  await page.getByLabel('Take profit enabled').check();
  await page.getByRole('button', { name: 'Swap Take profit input to price' }).click();
  await page.getByLabel('Take profit price').fill('1.0900');
  await expect
    .poll(
      async () =>
        (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args.takeProfit,
    )
    .toBe('1.0900');
  const request = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  await pushEvent(page, 'risk-preview', {
    ...request.args,
    riskBudget: '25.00',
    volume: '4.20',
    estimatedRisk: '57.75',
    estimatedReward: '57.75',
    estimatedMargin: '105.00',
    rr: '1.00',
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$57.75');
  await page.getByLabel('Risk amount').fill('59');
  // While the new broker preview is pending, the last 4.2 units and 0.005 price
  // distance give both amounts $57.75; a budget edit does not change volume.
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$57.75');
  await expect.poll(async () => (await stagedGeom(page))?.tpMoney).toBe('+$57.75');
  await expect.poll(async () => (await stagedGeom(page))?.riskRewardLabel).toBe('1.00');
  await expect(page.locator('.ticket-risk-reward')).toHaveText('RR 1.00');
  await expect
    .poll(
      async () =>
        (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args.riskAmount,
    )
    .toBe('59');
  const updated = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  await pushEvent(page, 'risk-preview', {
    ...updated.args,
    riskBudget: '59.00',
    volume: '4.20',
    estimatedRisk: '58.80',
    estimatedReward: '64.68',
    estimatedMargin: '105.00',
    rr: '1.10',
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$58.8');
  await expect.poll(async () => (await stagedGeom(page))?.tpMoney).toBe('+$64.68');
  await expect.poll(async () => (await stagedGeom(page))?.riskRewardLabel).toBe('1.10');
  await expect(page.locator('.ticket-risk-reward')).toHaveText('RR 1.10');
  expectClean(collected);
});

for (const level of ['sl', 'tp'] as const) {
  test(`staged ${level.toUpperCase()} drag updates shared RR and holds SL dollars until release`, async ({ page }) => {
    const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
    await openTradePanel(page);
    await fillRiskDraft(page);
    await page.getByLabel('Stop loss price').fill('1.0840');
    await page.getByLabel('Take profit enabled').check();
    await page.getByLabel('Take profit price').fill('1.0860');
    await expect
      .poll(
        async () => (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args,
      )
      .toMatchObject({ stopLoss: '1.0840', takeProfit: '1.0860' });
    const request = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
    await pushEvent(page, 'risk-preview', {
      ...request.args,
      riskBudget: '25.00',
      volume: '2.60',
      estimatedRisk: '25.00',
      estimatedReward: '24.50',
      estimatedMargin: '105.00',
      rr: '0.98',
      currency: 'USD',
      quotedAtMs: STUB_NOW,
    });
    // RR is independent of volume: it can match while the passive broker-volume
    // sync still leaves amounts based on the previous size. Capture the drag
    // baseline only once the complete broker sizing is mirrored on the chart.
    await expect
      .poll(async () => stagedGeom(page))
      .toMatchObject({
        volume: '2.60',
        slMoney: '-$25',
        tpMoney: '+$24.5',
        riskRewardLabel: '0.98',
      });
    const before = (await stagedGeom(page))!;
    const handle = level === 'sl' ? before.slHandle! : before.tpHandle!;
    const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + (level === 'sl' ? 24 : -24), { steps: 8 });
    const priceLabel = level === 'sl' ? 'Stop loss price' : 'Take profit price';
    await expect(page.getByLabel(priceLabel)).not.toHaveValue(level === 'sl' ? '1.0840' : '1.0860');
    if (level === 'sl') {
      await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe(before.slMoney);
    } else {
      await expect.poll(async () => (await stagedGeom(page))?.tpMoney).not.toBe(before.tpMoney);
    }
    await expect.poll(async () => (await stagedGeom(page))?.riskRewardLabel).not.toBe('0.98');
    const during = (await stagedGeom(page))!;
    await expect(page.locator('.ticket-risk-reward')).toHaveText(`RR ${during.riskRewardLabel}`);
    expect(level === 'sl' ? during.tpMoney : during.slMoney).toBe(level === 'sl' ? before.tpMoney : before.slMoney);
    await page.mouse.up();
    if (level === 'sl') {
      await expect.poll(async () => (await stagedGeom(page))?.slMoney).not.toBe(before.slMoney);
    }
    expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
    expectClean(collected);
  });
}

test('staged RR matches broker SL/TP amounts rather than equal price distances', async ({ page }) => {
  const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
  await openTradePanel(page);
  await fillRiskDraft(page);
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  await expect
    .poll(
      async () =>
        (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args.takeProfit,
    )
    .toBe('1.0900');
  const request = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  await pushEvent(page, 'risk-preview', {
    ...request.args,
    riskBudget: '25.00',
    volume: '2.60',
    estimatedRisk: '57.56',
    estimatedReward: '56.19',
    estimatedMargin: '105.00',
    rr: '0.98',
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$57.56');
  await expect.poll(async () => (await stagedGeom(page))?.tpMoney).toBe('+$56.19');
  await expect.poll(async () => (await stagedGeom(page))?.riskRewardLabel).toBe('0.98');
  await expect(page.locator('.ticket-risk-reward')).toHaveText('RR 0.98');
  expectClean(collected);
});

test('equity allocation defaults to 100 and invalidates sizing and review when edited', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  const allocation = page.getByRole('spinbutton', { name: 'Equity allocation percent' });
  await expect(allocation).toHaveValue('100');
  await expect(allocation).toBeDisabled();
  await fillRiskDraft(page);
  await expect(allocation).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args
          .equityAllocationPercent,
    )
    .toBe('100');
  for (const value of ['40', '60']) {
    await allocation.fill(value);
    await expect
      .poll(
        async () =>
          (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args
            .equityAllocationPercent,
      )
      .toBe(value);
    await page.getByRole('button', { name: 'Start creating order' }).click();
    await expect(page.locator('.order-check-result')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
    const checkedVersion = (await wasInvoked(page, 'request_order_check'))?.args.draftVersion as number;
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)?.args
            .draftVersion as number,
      )
      .toBeGreaterThan(checkedVersion);
  }
  const count = (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').length;
  await allocation.fill('101');
  await expect(page.locator('.notification-layer [role="alert"]')).toContainText(
    'Equity allocation must be greater than 0 and at most 100%.',
  );
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
  await expect
    .poll(async () => (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').length)
    .toBe(count);
  await allocation.fill('');
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
  await allocation.fill('40');
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeEnabled();
  expectClean(collected);
});

test('halving equity allocation halves the percent risk budget and updates checked volume', async ({ page }) => {
  const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
  await openTradePanel(page);
  await page.locator('.ticket-quote-side.buy').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  await page.getByLabel('Risk percent').fill('1');
  await page.getByLabel('Stop loss price').fill('1.0800');
  const latest = async () =>
    (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  await expect
    .poll(async () => (await latest())?.args)
    .toMatchObject({ riskAmount: '100.00', equityAllocationPercent: '100' });
  const full = await latest();
  const preview = (args: Record<string, unknown>, volume: string, budget: string) => ({
    ...args,
    volume,
    riskBudget: budget,
    estimatedRisk: budget,
    estimatedMargin: '1000',
    estimatedReward: null,
    rr: null,
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await pushEvent(page, 'risk-preview', preview(full.args, '1.00', '100.00'));
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
  await page.getByLabel('Equity allocation percent').fill('50');
  await expect
    .poll(async () => (await latest())?.args)
    .toMatchObject({ riskAmount: '50.00', equityAllocationPercent: '50' });
  await expect(page.locator('.ticket-hint').filter({ hasText: '≈' })).toHaveText('≈ 50.00 USD');
  const half = await latest();
  expect(half.args.draftVersion as number).toBeGreaterThan(full.args.draftVersion as number);
  await pushEvent(page, 'risk-preview', preview(half.args, '0.50', '50.00'));
  await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$50');
  // A late full-equity response cannot restore the previous volume/budget.
  await pushEvent(page, 'risk-preview', preview(full.args, '1.00', '100.00'));
  await page.getByRole('button', { name: 'Start creating order' }).click();
  await expect(page.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
  expect((await wasInvoked(page, 'request_order_check'))?.args.volume).toBe('0.50');
  expectClean(collected);
});

for (const mode of ['equity', 'money'] as const) {
  test(`${mode} SL drag resizes volume before release and broker confirmation keeps risk stable`, async ({ page }) => {
    const collected = await gotoWithStub(page, {
      responses: { request_risk_preview: null, project_risk_preview: 'reactive' },
    });
    await openTradePanel(page);
    await page.locator('.ticket-quote-side.buy').click();
    await page.locator('.ticket-menu-trigger').click();
    await page.getByRole('menuitemradio', { name: mode === 'equity' ? 'Risk, % equity' : 'Risk, USD' }).click();
    await page.getByLabel(mode === 'equity' ? 'Risk percent' : 'Risk amount').fill(mode === 'equity' ? '1' : '100');
    const riskBudget = mode === 'equity' ? '100.00' : '100';
    await page.getByLabel('Stop loss price').fill('1.0840');
    const latest = async () =>
      (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
    await expect.poll(async () => (await latest())?.args).toMatchObject({ stopLoss: '1.0840', riskAmount: riskBudget });
    const request = await latest();
    await pushEvent(page, 'risk-preview', {
      ...request.args,
      riskBudget: '100',
      volume: '1.00',
      estimatedRisk: '100',
      estimatedMargin: '200',
      estimatedReward: null,
      rr: null,
      currency: 'USD',
      quotedAtMs: STUB_NOW,
    });
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
    const handle = (await stagedGeom(page))!.slHandle!;
    const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 24, { steps: 8 });
    await expect(page.getByLabel('Stop loss price')).not.toHaveValue('1.0840');
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
    await expect.poll(async () => (await wasInvoked(page, 'project_risk_preview'))?.args.riskAmount).toBe(riskBudget);
    await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('0.50');
    await page.mouse.up();
    // Projection resizes the displayed volume but does not satisfy the broker preview gate.
    await page.getByRole('button', { name: 'Start creating order' }).click();
    await expect(page.getByRole('button', { name: 'Send order', exact: true })).toBeDisabled();
    expect((await wasInvoked(page, 'request_order_check'))?.args.volume).toBe('0.50');
    await page.mouse.up();
    await expect.poll(async () => (await latest())?.args.stopLoss).not.toBe('1.0840');
    const finalRequest = await latest();
    await pushEvent(page, 'risk-preview', {
      ...finalRequest.args,
      riskBudget: '100',
      volume: '0.50',
      estimatedRisk: '100',
      estimatedMargin: '100',
      estimatedReward: null,
      rr: null,
      currency: 'USD',
      quotedAtMs: STUB_NOW,
    });
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
    await expect(page.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
    // A delayed native projection must not overwrite a newer MT5 quote.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await latest())?.args.draftVersion as number)
      .toBeGreaterThan(finalRequest.args.draftVersion as number);
    await page.evaluate(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
        __releaseRiskProjection?: () => void;
      };
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        const value = await original(cmd, args);
        if (cmd !== 'project_risk_preview') {
          return value;
        }
        return new Promise((resolve) => {
          w.__releaseRiskProjection = () => resolve(value);
        });
      };
    });
    await page.getByLabel('Stop loss price').fill('1.0835');
    await expect.poll(async () => (await latest())?.args.stopLoss).toBe('1.0835');
    const newest = await latest();
    await pushEvent(page, 'risk-preview', {
      ...newest.args,
      riskBudget: '100',
      volume: '0.40',
      estimatedRisk: '80',
      estimatedMargin: '100',
      estimatedReward: null,
      rr: null,
      currency: 'USD',
      quotedAtMs: STUB_NOW,
    });
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$80');
    await page.evaluate(async () => {
      const w = window as unknown as { __releaseRiskProjection?: () => void };
      if (!w.__releaseRiskProjection) {
        throw new Error('Expected a pending native projection');
      }
      w.__releaseRiskProjection();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('0.40');
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$80');
    expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
    expectClean(collected);
  });
}

test('live quotes do not move market entry or exits during a staged drag', async ({ page }) => {
  const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
  await openTradePanel(page);
  await fillRiskDraft(page);
  await page.getByLabel('Stop loss price').fill('1.0840');
  await expect.poll(async () => (await stagedGeom(page))?.slHandle).not.toBeNull();
  const handle = (await stagedGeom(page))!.slHandle!;
  const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 24, { steps: 8 });
  const draggedStop = await page.getByLabel('Stop loss price').inputValue();
  await pushEvent(page, 'quote-update', {
    symbol: 'EURUSD',
    bid: '1.0859',
    ask: '1.0860',
    last: '1.0859',
    volume: 0,
    volumeReal: '0',
    flags: 3,
    timeMs: STUB_NOW + 1000,
  });
  await expect(page.locator('.ticket-quote-side.buy')).toContainText('1.0860');
  await expect(page.getByLabel('Order price')).toHaveValue('1.0850');
  await expect(page.getByLabel('Stop loss price')).toHaveValue(draggedStop);
  await page.mouse.up();
  await expect(page.getByLabel('Order price')).toHaveValue('1.0860');
  await expect
    .poll(async () => Number(await page.getByLabel('Stop loss price').inputValue()))
    .toBeCloseTo(Number(draggedStop) + 0.001, 4);
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expectClean(collected);
});

for (const mode of ['equity', 'money'] as const) {
  test(`${mode} SL dollar label stays frozen until mouse release`, async ({ page }) => {
    const collected = await gotoWithStub(page, {
      responses: { request_risk_preview: null, project_risk_preview: 'reactive' },
    });
    await openTradePanel(page);
    await page.locator('.ticket-quote-side.buy').click();
    await page.locator('.ticket-menu-trigger').click();
    await page.getByRole('menuitemradio', { name: mode === 'equity' ? 'Risk, % equity' : 'Risk, USD' }).click();
    await page.getByLabel(mode === 'equity' ? 'Risk percent' : 'Risk amount').fill(mode === 'equity' ? '1' : '100');
    await page.getByLabel('Stop loss price').fill('1.0840');
    const latest = async () =>
      (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
    await expect.poll(async () => (await latest())?.args.stopLoss).toBe('1.0840');
    const initial = await latest();
    const reply = (args: Record<string, unknown>, volume: string, risk: string) => ({
      ...args,
      riskBudget: '100',
      volume,
      estimatedRisk: risk,
      estimatedMargin: '100',
      estimatedReward: null,
      rr: null,
      currency: 'USD',
      quotedAtMs: STUB_NOW,
    });
    await pushEvent(page, 'risk-preview', reply(initial.args, '1.00', '100'));
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
    const handle = (await stagedGeom(page))!.slHandle!;
    const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 24, { steps: 8 });
    await expect.poll(async () => (await latest())?.args.stopLoss).not.toBe('1.0840');
    const moved = await latest();
    // A fresh broker result may refine volume while the display is held.
    await pushEvent(page, 'risk-preview', reply(moved.args, '0.40', '80'));
    await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('0.40');
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$100');
    await page.mouse.up();
    await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$80');
    expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
    expectClean(collected);
  });
}

for (const mode of ['equity', 'money'] as const) {
  for (const side of ['buy', 'sell'] as const) {
    test(`${mode} ${side} risk increases volume while keeping the seeded SL visible`, async ({ page }) => {
      const collected = await gotoWithStub(page, {
        responses: { request_risk_preview: null, project_risk_preview: 'reactive' },
      });
      await openTradePanel(page);
      await page.locator(`.ticket-quote-side.${side}`).click();
      await page.locator('.ticket-menu-trigger').click();
      await page.getByRole('menuitemradio', { name: mode === 'equity' ? 'Risk, % equity' : 'Risk, USD' }).click();
      const input = page.getByLabel(mode === 'equity' ? 'Risk percent' : 'Risk amount');
      await input.fill(mode === 'equity' ? '1' : '100');
      const latest = async () =>
        (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
      await expect.poll(async () => (await latest())?.args).toBeDefined();
      const initial = await latest();
      const stop = String(initial.args.stopLoss);
      const reply = (args: Record<string, unknown>, volume: string, risk: string) => ({
        ...args,
        riskBudget: args.riskAmount,
        volume,
        estimatedRisk: risk,
        estimatedMargin: '100',
        estimatedReward: null,
        rr: null,
        currency: 'USD',
        quotedAtMs: STUB_NOW,
      });
      await pushEvent(page, 'risk-preview', reply(initial.args, '2', '100'));
      await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('2');
      await expect(page.getByLabel('Stop loss price')).toHaveValue(stop);
      await input.fill(mode === 'equity' ? '100' : '1000');
      await expect.poll(async () => (await latest())?.args.riskAmount).not.toBe(initial.args.riskAmount);
      const increased = await latest();
      expect(increased.args.stopLoss).toBe(stop);
      await pushEvent(page, 'risk-preview', reply(increased.args, '17.3', '213.48'));
      await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('17.3');
      await expect(page.getByLabel('Stop loss price')).toHaveValue(stop);
      await expect.poll(async () => (await stagedGeom(page))?.slMoney).toBe('-$213.48');
      const geometry = (await stagedGeom(page))!;
      expect(Number(stop)).toBeGreaterThan(geometry.priceRange!.min);
      expect(Number(stop)).toBeLessThan(geometry.priceRange!.max);
      expect(geometry.slHandle).not.toBeNull();
      expect(
        (await stubInvocations(page)).some((item) => item.cmd === 'project_risk_preview' && item.args.targetVolume),
      ).toBe(false);
      // Capped broker sizing reports achievable risk; it must not move SL to spend the remainder.
      expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
      expectClean(collected);
    });
  }

  test(`${mode} risk sizing preserves SL distance through a quote before the broker reply`, async ({ page }) => {
    const collected = await gotoWithStub(page, {
      responses: { request_risk_preview: null, project_risk_preview: 'reactive' },
    });
    await openTradePanel(page);
    await page.locator('.ticket-quote-side.buy').click();
    await page.locator('.ticket-menu-trigger').click();
    await page.getByRole('menuitemradio', { name: mode === 'equity' ? 'Risk, % equity' : 'Risk, USD' }).click();
    await page.getByLabel(mode === 'equity' ? 'Risk percent' : 'Risk amount').fill(mode === 'equity' ? '100' : '1000');
    const latest = async () =>
      (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
    await expect.poll(async () => (await latest())?.args).toBeDefined();
    const initial = await latest();
    await pushEvent(page, 'quote-update', {
      symbol: 'EURUSD',
      bid: '1.0856',
      ask: '1.0860',
      last: '1.0858',
      volume: 0,
      volumeReal: '0',
      flags: 3,
      timeMs: STUB_NOW + 1000,
    });
    await expect.poll(async () => (await latest())?.args.entry).toBe('1.0860');
    const moved = await latest();
    expect(Number(moved.args.stopLoss)).toBeCloseTo(Number(initial.args.stopLoss) + 0.001, 4);
    await pushEvent(page, 'risk-preview', {
      ...moved.args,
      riskBudget: moved.args.riskAmount,
      volume: '17.3',
      estimatedRisk: '213.48',
      estimatedMargin: '5600',
      estimatedReward: null,
      rr: null,
      currency: 'USD',
      quotedAtMs: STUB_NOW + 1000,
    });
    await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('17.3');
    await expect(page.getByLabel('Stop loss price')).toHaveValue(String(moved.args.stopLoss));
    expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
    expectClean(collected);
  });
}

test('manual SL edit wins over a delayed risk volume projection', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    responses: { request_risk_preview: null, project_risk_preview: 'reactive' },
  });
  await openTradePanel(page);
  await fillRiskDraft(page);
  const latest = async () =>
    (await stubInvocations(page)).filter((item) => item.cmd === 'request_risk_preview').at(-1)!;
  const initial = await latest();
  await pushEvent(page, 'risk-preview', {
    ...initial.args,
    riskBudget: '25',
    volume: '1',
    estimatedRisk: '25',
    estimatedMargin: '100',
    estimatedReward: null,
    rr: null,
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('1');
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      __releaseRiskProjection?: () => void;
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      const value = await original(cmd, args);
      if (cmd !== 'project_risk_preview' || args?.riskAmount !== '100') {
        return value;
      }
      return new Promise((resolve) => {
        w.__releaseRiskProjection = () => resolve(value);
      });
    };
  });
  await page.getByLabel('Risk amount').fill('100');
  await expect
    .poll(async () =>
      page.evaluate(
        () => typeof (window as unknown as { __releaseRiskProjection?: () => void }).__releaseRiskProjection,
      ),
    )
    .toBe('function');
  await page.getByLabel('Stop loss price').fill('1.0820');
  await expect.poll(async () => (await latest())?.args.stopLoss).toBe('1.0820');
  await pushEvent(page, 'risk-preview', {
    ...(await latest()).args,
    riskBudget: '100',
    volume: '3',
    estimatedRisk: '100',
    estimatedMargin: '100',
    estimatedReward: null,
    rr: null,
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('3');
  await page.evaluate(async () => {
    (window as unknown as { __releaseRiskProjection?: () => void }).__releaseRiskProjection!();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.0820');
  await expect.poll(async () => (await stagedGeom(page))?.volume).toBe('3');
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expectClean(collected);
});

test('Risk % input clamps to 0–100, keeps decimals, and leaves money risk unrestricted', async ({ page }) => {
  const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
  await openTradePanel(page);
  await page.locator('.ticket-quote-side.buy').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  const percent = page.getByLabel('Risk percent');
  await percent.fill('101');
  await expect(percent).toHaveValue('100');
  await expect(percent).toHaveAttribute('min', '0');
  await expect(percent).toHaveAttribute('max', '100');
  await percent.fill('-1');
  await expect(percent).toHaveValue('0');
  await percent.fill('25.5');
  await expect(percent).toHaveValue('25.5');
  await percent.fill('');
  await expect(percent).toHaveValue('');
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await page.getByLabel('Risk amount').fill('1000');
  await expect(page.getByLabel('Risk amount')).toHaveValue('1000');
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expectClean(collected);
});

for (const mode of ['money', 'equity'] as const) {
  for (const side of ['buy', 'sell'] as const) {
    test(`${side} selecting ${mode} risk waits for a value before notifying about missing SL`, async ({ page }) => {
      const collected = await gotoWithStub(page, { responses: { request_risk_preview: null } });
      await openTradePanel(page);
      await page.locator(`.ticket-quote-side.${side}`).click();
      await page.locator('.ticket-menu-trigger').click();
      await page.getByRole('menuitemradio', { name: mode === 'money' ? 'Risk, USD' : 'Risk, % equity' }).click();
      const input = page.getByLabel(mode === 'money' ? 'Risk amount' : 'Risk percent');
      await expect(input).toHaveValue('');
      await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
      await expect(page.locator('.notification-region [role=alert]')).toHaveCount(0);
      expect(await wasInvoked(page, 'request_risk_preview')).toBeUndefined();
      await input.fill(mode === 'money' ? '100' : '1');
      await expect(page.getByLabel('Stop loss enabled')).toBeChecked();
      await expect(page.locator('.notification-region [role=alert]')).toHaveCount(0);
      await page.getByLabel('Stop loss enabled').uncheck();
      const notice = page.locator('.notification-region [role=alert]').filter({ hasText: 'needs a stop distance' });
      await expect(notice).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
      await input.fill('');
      await expect(notice).toBeHidden();
      expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
      expectClean(collected);
    });
  }
}
