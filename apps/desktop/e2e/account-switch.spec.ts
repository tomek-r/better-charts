import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTradePanel } from './helpers/panel';
import { stagedState } from './helpers/stagedWidget';
import {
  expectNoErrors,
  gotoWithStub,
  pushEvent,
  stubInvocations,
  wasInvoked,
  windowCandles,
} from './helpers/tauriStub';

const NEW_ACCOUNT = {
  accountLogin: '70001234',
  brokerServer: 'Broker-Live',
  accountTradeMode: 2,
  accountTradeModeName: 'real',
  currency: 'USD',
  currencyDigits: 2,
  balance: '5000.00',
  equity: '5000.00',
  margin: '0.00',
  freeMargin: '5000.00',
  marginLevel: '0.00',
  leverage: 30,
  marginMode: 2,
  tradeAllowed: true,
  expertAllowed: true,
};

/** The EA reconnects with the new login: the bridge re-handshakes, then re-sends the account. */
async function switchAccount(
  page: Page,
  account: Record<string, unknown> & typeof NEW_ACCOUNT = NEW_ACCOUNT,
  tradingEnabled = true,
): Promise<void> {
  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'account identity changed' });
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    protocolVersion: '2.1',
    terminal: 'MetaTrader 5 (demo)',
    account: account.accountLogin,
    server: account.brokerServer,
    tradingEnabled,
    marketSession: { symbol: 'EURUSD', isOpen: true, tradeMode: 4, serverTimeMs: 1745700000000 },
  });
  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M5',
    complete: true,
    candles: windowCandles(10),
  });
  await pushEvent(page, 'account-snapshot', account);
}

async function stageWithStopLoss(page: Page): Promise<void> {
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await expect.poll(() => stagedState(page)).toBe(true);
  await page.getByLabel('Stop loss enabled').check();
}

const switchedDialog = (page: Page, text: string) => page.getByRole('dialog', { name: text });

test('an account switch clears staged drafts and announces the new account in a dismissible dialog', async ({
  page,
}) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await stageWithStopLoss(page);
  await expect(page.getByLabel('Stop loss enabled')).toBeChecked();

  await switchAccount(page);

  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(dialog).toBeVisible();
  await expect.poll(() => stagedState(page)).toBe(false);
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.locator('.ticket-title .ticket-account-badge')).toHaveText('REAL · 70001234');

  // Keyboard: focus lands on Dismiss, Tab stays trapped inside, Enter dismisses.
  const dismiss = dialog.getByRole('button', { name: 'Dismiss' });
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expectNoErrors(collected);
});

test('the dialog states that algo trading is enabled', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page);
  const status = switchedDialog(page, 'Account was switched to Real 70001234').getByRole('status');
  await expect(status).toHaveText('Algo trading is enabled');
  await expect(status).toHaveAttribute('data-algo-trading', 'enabled');
  await expect(status.locator('svg')).toHaveAttribute('data-algo-icon', 'check');
});

test('the dialog warns when algo trading is disabled and updates live once it is turned on', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page, NEW_ACCOUNT, false);
  const status = switchedDialog(page, 'Account was switched to Real 70001234').getByRole('status');
  await expect(status).toHaveText('Turn on Algo Trading in MT5 in order to send orders');
  await expect(status).toHaveAttribute('data-algo-trading', 'disabled');
  await expect(status.locator('svg')).toHaveAttribute('data-algo-icon', 'warning');
  // The icon sits on the line's vertical centre.
  const line = (await status.boundingBox())!;
  const icon = (await status.locator('svg').boundingBox())!;
  expect(Math.abs(icon.y + icon.height / 2 - (line.y + line.height / 2))).toBeLessThanOrEqual(1);

  // The EA reconnects after Algo Trading is turned on: same account, new session.
  await pushEvent(page, 'bridge-status', {
    state: 'connected',
    protocolVersion: '2.1',
    terminal: 'MetaTrader 5 (demo)',
    account: NEW_ACCOUNT.accountLogin,
    server: NEW_ACCOUNT.brokerServer,
    tradingEnabled: true,
    marketSession: { symbol: 'EURUSD', isOpen: true, tradeMode: 4, serverTimeMs: 1745700000000 },
  });
  await expect(status).toHaveText('Algo trading is enabled');
  await expect(status.locator('svg')).toHaveAttribute('data-algo-icon', 'check');
});

const infoValue = (dialog: Locator, label: string) =>
  dialog
    .locator('.account-switch-info > div')
    .filter({ has: dialog.page().locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

test('the dialog lists the new account details for a hedging percent-mode account', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page, {
    ...NEW_ACCOUNT,
    equity: '5120.50',
    marginMode: 2,
    marginCallLevel: '120',
    stopOutLevel: '80',
    marginLevelsUnit: 'percent',
  });
  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(infoValue(dialog, 'Server')).toHaveText('Broker-Live');
  await expect(infoValue(dialog, 'Balance')).toHaveText('5,000.00 USD');
  await expect(infoValue(dialog, 'Equity')).toHaveText('5,120.50 USD');
  await expect(infoValue(dialog, 'Leverage')).toHaveText('1:30');
  await expect(infoValue(dialog, 'Account')).toHaveText('Hedging');
  await expect(infoValue(dialog, 'Margin call / Stop out')).toHaveText('120% · 80%');
});

test('the dialog lists a netting money-mode account and hides equal equity', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page, {
    ...NEW_ACCOUNT,
    marginMode: 0,
    marginCallLevel: '300.00',
    stopOutLevel: '150.00',
    marginLevelsUnit: 'money',
  });
  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(infoValue(dialog, 'Account')).toHaveText('Netting');
  await expect(infoValue(dialog, 'Margin call / Stop out')).toHaveText('300.00 USD · 150.00 USD');
  await expect(infoValue(dialog, 'Equity')).toHaveCount(0);
});

test('a missing field hides its row instead of showing a blank', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page, { ...NEW_ACCOUNT, marginMode: -1 });
  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(infoValue(dialog, 'Server')).toHaveText('Broker-Live');
  await expect(infoValue(dialog, 'Account')).toHaveCount(0);
  await expect(infoValue(dialog, 'Margin call / Stop out')).toHaveCount(0);
});

test('the dialog balance updates live while it is open', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page);
  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(infoValue(dialog, 'Balance')).toHaveText('5,000.00 USD');
  await pushEvent(page, 'account-snapshot', { ...NEW_ACCOUNT, balance: '5250.25', equity: '5250.25' });
  await expect(infoValue(dialog, 'Balance')).toHaveText('5,250.25 USD');
});

test('Escape dismisses the account switch dialog', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await switchAccount(page);
  const dialog = switchedDialog(page, 'Account was switched to Real 70001234');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a new order can be staged, checked and sent for the switched account', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openTradePanel(page);
  await stageWithStopLoss(page);
  await switchAccount(page);
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await expect.poll(() => stagedState(page)).toBe(true);
  await page.locator('.ticket-cta').click();
  await expect(page.locator('.order-check-result')).toBeVisible();
  await page.locator('.ticket-cta.send').click();
  await expect
    .poll(async () => (await wasInvoked(page, 'submit_order'))?.args)
    .toMatchObject({
      accountLogin: '70001234',
      brokerServer: 'Broker-Live',
      symbol: 'EURUSD',
    });
  expectNoErrors(collected);
});

test('reconnecting to the same account does not clear drafts or show the dialog', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await stageWithStopLoss(page);
  await switchAccount(page, {
    ...NEW_ACCOUNT,
    accountLogin: '50123456',
    brokerServer: 'Broker-Demo',
    accountTradeMode: 0,
    accountTradeModeName: 'demo',
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => stagedState(page)).toBe(true);
  expect((await stubInvocations(page)).some((entry) => entry.cmd === 'submit_order')).toBe(false);
});

test('first connection announces nothing', async ({ page }) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await expect(page.locator('.ticket-title .ticket-account-badge')).toHaveText('DEMO · 50123456');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
