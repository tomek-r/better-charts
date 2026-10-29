import { test, expect, type Page } from '@playwright/test';
import { fillExitPrice, openTradePanel } from './helpers/panel';
import { brokerSymbolFixture, expectNoErrors, gotoWithStub, STUB_NOW, stubInvocations } from './helpers/tauriStub';

// Pins the exact wire payloads (values and key order) of the order-check and
// submit commands, and the dispatch-locked copy of both execution paths.

const eurusd = brokerSymbolFixture('EURUSD', 'Euro / US Dollar', { stopsLevel: 10 });

const DISPATCH_LOCKED_TEXT = 'Dispatch locked — nothing was sent to MT5. Owner approval required.';

const ORDER_CHECK_KEYS = [
  'accountLogin',
  'brokerServer',
  'symbol',
  'side',
  'orderKind',
  'volume',
  'entry',
  'stopLoss',
  'takeProfit',
  'timeInForce',
  'limitPrice',
  'draftVersion',
];

const SUBMIT_KEYS = [
  'draftId',
  'accountLogin',
  'brokerServer',
  'symbol',
  'side',
  'orderKind',
  'volume',
  'entry',
  'stopLoss',
  'takeProfit',
  'timeInForce',
  'limitPrice',
];

type Args = Record<string, unknown>;

/** Opens the ticket, lets `draftOrder` fill it, then runs the check and sends; returns both payloads. */
async function checkAndSubmit(page: Page, draftOrder: (page: Page) => Promise<void>) {
  const collected = await gotoWithStub(page, { symbolInfo: eurusd });
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await expect(ticket.locator('.ticket-tick-value')).toBeVisible();
  await draftOrder(page);
  await ticket.locator('.ticket-cta').click();
  const send = ticket.getByRole('button', { name: 'Send order', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'submit_order').length)
    .toBe(1);
  const invocations = await stubInvocations(page);
  const check = invocations.filter((entry) => entry.cmd === 'request_order_check').at(-1)!.args as Args;
  const submit = invocations.find((entry) => entry.cmd === 'submit_order')!.args as Args;
  return { collected, check, submit };
}

function expectWirePayloads(payloads: { check: Args; submit: Args }, expected: Omit<Args, 'draftId' | 'draftVersion'>) {
  expect(Object.keys(payloads.check)).toEqual(ORDER_CHECK_KEYS);
  expect(Object.keys(payloads.submit)).toEqual(SUBMIT_KEYS);
  expect(payloads.check).toEqual({ ...expected, draftVersion: expect.anything() });
  expect(payloads.submit).toEqual({ ...expected, draftId: 'draft-001' });
}

const base = {
  accountLogin: '50123456',
  brokerServer: 'Broker-Demo',
  symbol: 'EURUSD',
  timeInForce: 'gtc',
};

test('market buy with stop loss and take profit sends identical order fields to check and submit', async ({ page }) => {
  const payloads = await checkAndSubmit(page, async (target) => {
    await target.locator('.ticket-quote-side.buy').click();
    await fillExitPrice(target, 'Stop loss', '1.0800');
    await fillExitPrice(target, 'Take profit', '1.0900');
  });
  expectWirePayloads(payloads, {
    ...base,
    side: 'buy',
    orderKind: 'market',
    volume: '0.01',
    entry: '1.085',
    stopLoss: '1.0800',
    takeProfit: '1.0900',
    limitPrice: null,
  });
  expectNoErrors(payloads.collected);
});

test('limit sell without take profit sends a null take profit', async ({ page }) => {
  const payloads = await checkAndSubmit(page, async (target) => {
    await target.locator('.ticket-quote-side.sell').click();
    await target.getByRole('button', { name: 'Limit', exact: true }).click();
    await target.getByLabel('Order price').fill('1.09000');
    await fillExitPrice(target, 'Stop loss', '1.09200');
  });
  expectWirePayloads(payloads, {
    ...base,
    side: 'sell',
    orderKind: 'limit',
    volume: '0.01',
    entry: '1.09000',
    stopLoss: '1.09200',
    takeProfit: null,
    limitPrice: null,
  });
  expectNoErrors(payloads.collected);
});

test('stop limit sends the trigger as entry and the resting price as limit price', async ({ page }) => {
  const payloads = await checkAndSubmit(page, async (target) => {
    await target.locator('.ticket-quote-side.buy').click();
    await target.getByRole('button', { name: 'Stop Limit', exact: true }).click();
    await target.getByLabel('Order price').fill('1.09000');
    await target.getByLabel('Limit price').fill('1.08000');
    await fillExitPrice(target, 'Stop loss', '1.07800');
  });
  expectWirePayloads(payloads, {
    ...base,
    side: 'buy',
    orderKind: 'stop_limit',
    volume: '0.01',
    entry: '1.09000',
    stopLoss: '1.07800',
    takeProfit: null,
    limitPrice: '1.08000',
  });
  expectNoErrors(payloads.collected);
});

test('stop loss switched off sends a null stop loss', async ({ page }) => {
  const payloads = await checkAndSubmit(page, async (target) => {
    await target.locator('.ticket-quote-side.buy').click();
  });
  expectWirePayloads(payloads, {
    ...base,
    side: 'buy',
    orderKind: 'market',
    volume: '0.01',
    entry: '1.085',
    stopLoss: null,
    takeProfit: null,
    limitPrice: null,
  });
  expectNoErrors(payloads.collected);
});

test('ticket submit and portfolio close show the same dispatch-locked text', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    symbolInfo: eurusd,
    failures: {
      submit_order: 'Dispatch is disabled by owner policy.',
      close_position: 'Dispatch is disabled by owner policy.',
    },
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
        orders: [],
      },
    },
  });
  await openTradePanel(page);
  const alerts = page.locator('.notification-region [role=alert]').filter({ hasText: 'Dispatch locked' });

  await page.locator('.portfolio-row .portfolio-action').first().click();
  await expect(alerts).toHaveText(DISPATCH_LOCKED_TEXT);

  const ticket = page.locator('section.order-ticket');
  await expect(ticket.locator('.ticket-tick-value')).toBeVisible();
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.locator('.ticket-cta').click();
  const send = ticket.getByRole('button', { name: 'Send order', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(alerts.last()).toHaveText(DISPATCH_LOCKED_TEXT);
  expectNoErrors(collected);
});
