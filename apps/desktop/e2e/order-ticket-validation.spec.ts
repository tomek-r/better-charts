import { test, expect } from '@playwright/test';
import {
  deriveOrderTicket,
  orderEntryPrice,
  riskRewardRatio,
  stopDistanceGuard,
} from '../src/features/order-ticket/domain/ticketRules';
import type { BrokerSymbol, QuoteSnapshot } from '../src/shared/bridge/types';
import { openTradePanel } from './panel';
import { gotoWithStub, pushEvent, stubInvocations, wasInvoked } from './tauriStub';

const instrument: BrokerSymbol = {
  symbol: 'TEST',
  description: 'Test instrument',
  digits: 2,
  tickSize: '0.01',
  pointSize: '0.01',
  contractSize: '1',
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
};

const quote: QuoteSnapshot = {
  symbol: 'TEST',
  timeMs: 0,
  bid: '100.00',
  ask: '101.00',
  last: '100.50',
  volume: 0,
  volumeReal: '0',
  flags: 0,
};

const eurusd: BrokerSymbol = {
  ...instrument,
  symbol: 'EURUSD',
  description: 'Euro / US Dollar',
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  contractSize: '100000',
  volumeMin: '0.01',
  volumeMax: '100',
  volumeStep: '0.01',
  stopsLevel: 10,
};

async function openTicket(page: Parameters<typeof gotoWithStub>[0]) {
  const collected = await gotoWithStub(page, { symbolInfo: eurusd });
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await expect(ticket.getByLabel('Take profit enabled')).toBeVisible();
  await expect(ticket.locator('.ticket-tick-value')).toBeVisible();
  return { collected, ticket };
}

async function latestInvoke(page: Parameters<typeof stubInvocations>[0], command: string) {
  const invokes = await stubInvocations(page);
  return invokes.filter((invoke) => invoke.cmd === command).at(-1);
}

async function fillExitPrice(
  page: Parameters<typeof gotoWithStub>[0],
  label: 'Take profit' | 'Stop loss',
  price: string,
) {
  await page.getByLabel(`${label} enabled`).check();
  await page.getByLabel(`Swap ${label} input to price`).click();
  await page.getByLabel(`${label} price`).fill(price);
}

test('pending order TP distances use the executable entry reference', () => {
  const buyLimit = stopDistanceGuard(instrument, 'buy', '98', '', '98.50', quote, 'limit');
  expect(buyLimit?.tpTooClose).toBe(false); // Below the current ask, safely above the buy limit.

  const buyStopLimit = deriveOrderTicket({
    symbol: 'TEST',
    bridgeState: 'disconnected',
    account: undefined,
    stagedOnChart: false,
    riskSide: 'buy',
    entry: '105',
    stopLoss: '',
    takeProfit: '99.50',
    slOn: false,
    tpOn: true,
    orderKind: 'stop_limit',
    limitPrice: '99',
    timeInForce: 'gtc',
    unitsMode: 'units',
    orderVolume: '',
    orderCheck: undefined,
    riskPreview: undefined,
    draftVersion: 0,
    riskLoading: false,
    instrument,
    quote,
    marketOpen: true,
  });
  expect(buyStopLimit.stopGuard?.tpTooClose).toBe(false); // Uses resting 99, not trigger 105 or ask 101.

  const sellLimit = stopDistanceGuard(instrument, 'sell', '103', '', '102.50', quote, 'limit');
  expect(sellLimit?.tpTooClose).toBe(false); // Sell-side mirror: target is above the current bid.
});

test('pending TP must be strictly beyond the minimum distance from its reference', () => {
  expect(stopDistanceGuard(instrument, 'buy', '98', '', '98', quote, 'limit')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'buy', '98', '', '98.20', quote, 'limit')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'buy', '98', '', '98.50', quote, 'limit')?.tpTooClose).toBe(false);
  expect(stopDistanceGuard(instrument, 'sell', '103', '', '103', quote, 'limit')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'sell', '103', '', '102.80', quote, 'limit')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'sell', '103', '', '102.50', quote, 'limit')?.tpTooClose).toBe(false);
  expect(stopDistanceGuard(instrument, 'buy', '105', '', '99', quote, 'stop_limit', '99')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'buy', '105', '', '99.20', quote, 'stop_limit', '99')?.tpTooClose).toBe(true);
});

test('market TP retains its live quote-side guard and invalid stop-limit price has no fallback reference', () => {
  expect(stopDistanceGuard(instrument, 'buy', '98', '', '101.20', quote, 'market')?.tpTooClose).toBe(true);
  expect(stopDistanceGuard(instrument, 'buy', '105', '', '99.50', quote, 'stop_limit', '')?.tpTooClose).toBe(false);
  expect(stopDistanceGuard(undefined, 'buy', '98', '', '98.50', quote, 'limit')).toBeUndefined();
  expect(orderEntryPrice('stop_limit', '105', '99')).toBe('99');
  expect(orderEntryPrice('stop_limit', '105', '')).toBe('');
  expect(orderEntryPrice('limit', '98', '99')).toBe('98');
});

test('Buy Limit accepts a TP between its entry and the live ask and sends the draft to OrderCheck', async ({
  page,
}) => {
  const { collected, ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Order price').fill('1.08000');
  await fillExitPrice(page, 'Take profit', '1.08200');

  const cta = ticket.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  expect((await wasInvoked(page, 'request_order_check'))?.args).toMatchObject({
    side: 'buy',
    orderKind: 'limit',
    entry: '1.08000',
    takeProfit: '1.08200',
  });
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('Buy Stop Limit uses its resting price for risk sizing and TP ticks, then checks trigger and exits', async ({
  page,
}) => {
  const { collected, ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.getByRole('button', { name: 'Stop Limit', exact: true }).click();
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await page.getByLabel('Order price').fill('1.09000');
  await page.getByLabel('Limit price').fill('1.08000');
  await fillExitPrice(page, 'Stop loss', '1.07800');
  await fillExitPrice(page, 'Take profit', '1.08200');
  await page.getByLabel('Swap Take profit input to ticks').click();
  await expect(page.getByLabel('Take profit ticks')).toHaveValue('200');
  await page.getByLabel('Swap Take profit input to price').click();

  await page.getByLabel('Risk amount').fill('25');
  await expect
    .poll(async () => (await latestInvoke(page, 'request_risk_preview'))?.args)
    .toMatchObject({ entry: '1.08000', stopLoss: '1.07800', takeProfit: '1.08200' });

  const cta = ticket.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  expect((await wasInvoked(page, 'request_order_check'))?.args).toMatchObject({
    side: 'buy',
    orderKind: 'stop_limit',
    entry: '1.09000',
    limitPrice: '1.08000',
    stopLoss: '1.07800',
    takeProfit: '1.08200',
  });
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('Sell Limit accepts the mirrored TP above the live bid', async ({ page }) => {
  const { collected, ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.sell').click();
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Order price').fill('1.09000');
  await fillExitPrice(page, 'Take profit', '1.08800');

  const cta = ticket.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  expect((await wasInvoked(page, 'request_order_check'))?.args).toMatchObject({
    side: 'sell',
    orderKind: 'limit',
    entry: '1.09000',
    takeProfit: '1.08800',
  });
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('Market still rejects a buy TP below the current ask without requesting OrderCheck', async ({ page }) => {
  const { ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await fillExitPrice(page, 'Take profit', '1.08200');

  await expect(ticket.locator('.ticket-cta')).toBeDisabled();
  expect(await wasInvoked(page, 'request_order_check')).toBeUndefined();
});

test('rendered risk freshness rejects an old preview and accepts the current version', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    symbolInfo: eurusd,
    responses: { request_risk_preview: null },
  });
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await expect(ticket.locator('.ticket-tick-value')).toBeVisible();
  await ticket.locator('.ticket-quote-side.buy').click();
  // A market draft is exempt from preview freshness at the check stage (it
  // follows every quote tick), so this case has to be a pending order for the
  // gate below to be the thing under test.
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await page.getByLabel('Order price').fill('1.08000');
  await fillExitPrice(page, 'Stop loss', '1.07900');
  await page.getByLabel('Risk amount').fill('25');
  await expect.poll(async () => (await latestInvoke(page, 'request_risk_preview'))?.args.riskAmount).toBe('25');
  const oldRequest = (await latestInvoke(page, 'request_risk_preview'))!;
  const preview = {
    ...oldRequest.args,
    riskBudget: '25.00',
    volume: '0.10',
    estimatedRisk: '12.50',
    estimatedReward: '25.00',
    estimatedMargin: '105.00',
    rr: '2.00',
    currency: 'USD',
    quotedAtMs: 1745700000000,
  };
  await pushEvent(page, 'risk-preview', preview);
  await expect(ticket.locator('.ticket-cta')).toBeEnabled();
  await page.getByLabel('Risk amount').fill('50');
  await expect.poll(async () => (await latestInvoke(page, 'request_risk_preview'))?.args.riskAmount).toBe('50');
  const currentRequest = (await latestInvoke(page, 'request_risk_preview'))!;
  expect(Number(currentRequest.args.draftVersion)).toBeGreaterThan(Number(oldRequest.args.draftVersion));
  await pushEvent(page, 'risk-preview', preview);
  await expect(ticket.locator('.ticket-cta')).toBeDisabled();
  await pushEvent(page, 'risk-preview', { ...preview, ...currentRequest.args, riskBudget: '50.00' });
  await expect(ticket.locator('.ticket-cta')).toBeEnabled();
  await ticket.locator('.ticket-cta').click();
  await expect(ticket.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
  expect((await latestInvoke(page, 'request_order_check'))?.args.draftVersion).toBe(currentRequest.args.draftVersion);
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('no-SL draft edits advance the rendered freshness token without requesting a preview', async ({ page }) => {
  const { collected, ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Order price').fill('1.08000');
  await ticket.locator('.ticket-cta').click();
  await expect(ticket.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
  const first = (await latestInvoke(page, 'request_order_check'))!;
  await ticket.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Order price').fill('1.07900');
  await ticket.locator('.ticket-cta').click();
  await expect(ticket.getByRole('button', { name: 'Send order', exact: true })).toBeEnabled();
  const second = (await latestInvoke(page, 'request_order_check'))!;
  expect(Number(second.args.draftVersion)).toBeGreaterThan(Number(first.args.draftVersion));
  expect(await latestInvoke(page, 'request_risk_preview')).toBeUndefined();
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('risk input uses the latest market quote for its default stop', async ({ page }) => {
  const { ticket, collected } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.locator('.ticket-menu-trigger').click();
  await ticket.getByRole('menuitemradio', { name: 'Risk, USD' }).click();
  await pushEvent(page, 'quote-update', {
    ...quote,
    symbol: 'EURUSD',
    bid: '1.09000',
    ask: '1.09020',
    last: '1.09000',
    timeMs: 1745700001000,
  });
  await expect(page.getByLabel('Order price')).toHaveValue('1.09020');
  await page.getByLabel('Risk amount').fill('25');
  await page.getByLabel('Swap Stop loss input to price').click();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.08978');
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('market quote changes update stop validation and the review gate', async ({ page }) => {
  const { ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await fillExitPrice(page, 'Stop loss', '1.08400');
  const action = ticket.locator('.ticket-cta');
  await expect(action).toBeEnabled();
  await pushEvent(page, 'quote-update', {
    ...quote,
    symbol: 'EURUSD',
    bid: '1.08410',
    ask: '1.08500',
    last: '1.08410',
    timeMs: 1745700001000,
  });
  await expect(action).toBeDisabled();
  await expect(page.getByLabel('Stop loss price')).toHaveClass(/invalid/);
  await pushEvent(page, 'quote-update', {
    ...quote,
    symbol: 'EURUSD',
    bid: '1.08460',
    ask: '1.08500',
    last: '1.08460',
    timeMs: 1745700002000,
  });
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  expect((await latestInvoke(page, 'request_order_check'))?.args).toMatchObject({
    entry: '1.085',
    stopLoss: '1.08400',
    side: 'buy',
  });
});

test('review action reads the latest draft fields after editing', async ({ page }) => {
  const { ticket } = await openTicket(page);
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Order price').fill('1.08000');
  await page.getByLabel('Units', { exact: true }).fill('0.25');
  await ticket.getByRole('button', { name: 'Extra settings' }).click();
  await ticket.getByRole('combobox', { name: 'Time in force' }).selectOption('day');
  await ticket.locator('.ticket-cta').click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  expect((await latestInvoke(page, 'request_order_check'))?.args).toMatchObject({
    entry: '1.08000',
    volume: '0.25',
    timeInForce: 'day',
    orderKind: 'limit',
  });
});

test('RR uses broker money estimates when they differ from price distances', () => {
  expect(
    riskRewardRatio('buy', '100', '99', '101', {
      estimatedRisk: '57.56',
      estimatedReward: '56.19',
    }),
  ).toBe('0.98');
  expect(
    riskRewardRatio('sell', '100', '101', '99', {
      estimatedRisk: '57.56',
      estimatedReward: '56.19',
    }),
  ).toBe('0.98');
  expect(riskRewardRatio('buy', '100', '99', '101')).toBe('1.00');
});

test('pending price offsets preserve entry on swap and follow the selected quote', async ({ page }) => {
  await openTicket(page);
  await page.locator('.ticket-quote-side.buy').click();
  await page.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByLabel('Order price', { exact: true }).fill('1.08000');
  await page.getByRole('button', { name: 'Enter price as an offset from the reference', exact: true }).click();
  await expect(page.getByLabel('Price offset in ticks')).toHaveValue('-500');
  await page.getByLabel('Price reference').selectOption('bid');
  await page.getByLabel('Price offset in ticks').fill('-10');
  await page.getByRole('button', { name: 'Enter an absolute price', exact: true }).click();
  await expect(page.getByLabel('Order price', { exact: true })).toHaveValue('1.0845');
  await page.getByRole('button', { name: 'Enter price as an offset from the reference', exact: true }).click();
  await pushEvent(page, 'quote-update', {
    symbol: 'EURUSD',
    timeMs: 1745700001000,
    bid: '1.08600',
    ask: '1.08630',
    last: '1.08610',
    volume: 0,
    volumeReal: '0',
    flags: 0,
  });
  await page.getByRole('button', { name: 'Enter an absolute price', exact: true }).click();
  await expect(page.getByLabel('Order price', { exact: true })).toHaveValue('1.0859');
  await page.getByRole('button', { name: 'Enter price as an offset from the reference', exact: true }).click();
  await page.getByLabel('Price reference').selectOption('ask');
  await page.getByLabel('Price offset in ticks').fill('10');
  await page.getByRole('button', { name: 'Enter an absolute price', exact: true }).click();
  await expect(page.getByLabel('Order price', { exact: true })).toHaveValue('1.0864');
  await page.getByRole('button', { name: 'Enter price as an offset from the reference', exact: true }).click();
  await expect(page.getByLabel('Price reference').locator('option')).toHaveText(['Ask', 'Bid']);
  await page.getByLabel('Price offset in ticks').fill('');
  await expect(page.locator('section.order-ticket .ticket-cta')).toBeDisabled();
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await expect(page.getByLabel('Price offset in ticks')).toHaveCount(0);
  await expect(page.getByLabel('Order price', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Enter price as an offset from the reference', exact: true }),
  ).toBeDisabled();
});
