import { expect, test } from '@playwright/test';
import { levelMoneyText, toPositionLine, toOrderLine } from '../src/features/chart/engine/overlayLines';
import { formatSignedMoney } from '../src/shared/format';
import { accountMoneyBasis } from '../src/shared/money';
import { deriveOrderRiskBasis } from '../src/features/order-ticket/domain/riskBasis';
import { gotoWithStub, stubInvocations } from './tauriStub';
import { openTradePanel } from './panel';

test('exit estimates use converted account-currency tick values for gains and losses', () => {
  const money = {
    currency: 'PLN',
    tickSize: 0.1,
    tickValueProfit: 0.4,
    tickValueLoss: 0.42,
  };
  expect(levelMoneyText(100, 90, 2, 'buy', money)).toBe(formatSignedMoney(-84, 'PLN'));
  expect(levelMoneyText(100, 110, 2, 'buy', money)).toBe(formatSignedMoney(80, 'PLN'));
  expect(levelMoneyText(100, 110, 2, 'sell', money)).toBe(formatSignedMoney(-84, 'PLN'));
});

test('percentage risk uses the account monetary precision', () => {
  const basis = deriveOrderRiskBasis({
    unitsMode: 'equity',
    riskAmount: '1',
    equity: '1234.5',
    currency: 'KWD',
    currencyDigits: 3,
    stagedOnChart: true,
  });
  expect(basis.effectiveRiskAmount).toBe('12.345');
  expect(basis.riskModeHint).toBe('≈ 12.345 KWD');
});

test('live exits retain broker account amounts without tick metadata', () => {
  const position = {
    ticket: '1',
    positionId: '1',
    symbol: 'NAS100',
    timeMs: 0,
    magic: '0',
    side: 'buy',
    volume: '1',
    priceOpen: '100',
    priceCurrent: '101',
    profit: '1',
    swap: '0',
    stopLoss: '90',
    takeProfit: '110',
    stopLossProfit: '-42.12',
    takeProfitProfit: '40.11',
  };
  const line = toPositionLine(position, undefined, 'PLN');
  expect(line?.slMoney).toBe('-42.12 PLN');
  expect(line?.tpMoney).toBe('+40.11 PLN');
  const order = {
    ...position,
    orderId: '2',
    orderType: 'buy_limit',
    state: 'placed',
    timeSetupMs: 0,
    volumeInitial: '1',
    volumeCurrent: '1',
  };
  expect(toOrderLine(order, undefined, 'PLN')?.slMoney).toBe('-42.12 PLN');
  expect(toPositionLine({ ...position, stopLoss: null }, undefined, 'PLN')?.slMoney).toBeUndefined();
});

test('converted estimates reject mismatched or unavailable currency metadata', () => {
  const instrument = {
    symbol: 'NAS100',
    description: '',
    digits: 1,
    tickSize: '0.1',
    pointSize: '0.1',
    contractSize: '1',
    volumeMin: '0.1',
    volumeMax: '100',
    volumeStep: '0.1',
    tradeMode: 4,
    stopsLevel: 0,
    freezeLevel: 0,
    fillingMode: 1,
    orderMode: 127,
    expirationMode: 15,
    tradeExecution: 2,
    tickValueCurrency: 'USD',
    tickValueProfit: '0.1',
    tickValueLoss: '0.1',
  };
  expect(accountMoneyBasis(instrument, 'PLN')).toBeUndefined();
  expect(accountMoneyBasis({ ...instrument, tickValueProfit: null, tickValueLoss: null }, 'USD')).toBeUndefined();
});

for (const currency of ['USD', 'EUR', 'PLN']) {
  test(`${currency} account money risk and preview retain the deposit currency`, async ({ page }) => {
    await gotoWithStub(page, {
      responses: {
        get_account_snapshot: {
          accountLogin: '50123456',
          brokerServer: 'Broker-Demo',
          currency,
          currencyDigits: 2,
          balance: '10000',
          equity: '10000',
          margin: '500',
          freeMargin: '9500',
          marginLevel: '2000',
          leverage: 100,
          marginMode: 0,
          tradeAllowed: true,
          expertAllowed: true,
          accountTradeMode: 0,
        },
      },
    });
    await openTradePanel(page);
    await page.locator('.ticket-quote-side.buy').click();
    await page.locator('.ticket-menu-trigger').click();
    await page.getByRole('menuitemradio', { name: `Risk, ${currency}` }).click();
    await page.getByLabel('Stop loss enabled').check();
    await page.getByLabel('Stop loss price').fill('1.0800');
    await page.getByLabel('Risk amount').fill('100');
    await expect
      .poll(
        async () =>
          (await stubInvocations(page)).filter(({ cmd }) => cmd === 'request_risk_preview').at(-1)?.args.riskAmount,
      )
      .toBe('100');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = window as unknown as { __stagedWidgetTest?: { geometry(): { slMoney?: string } } };
          return state.__stagedWidgetTest?.geometry().slMoney;
        }),
      )
      .toBe(`-12.50 ${currency}`);
    await page.getByRole('button', { name: 'Start creating order', exact: true }).click();
    const check = page.getByLabel('MT5 OrderCheck result');
    await expect(check).toContainText(`105.00 ${currency}`);
    await expect(check).toContainText(`9,895.00 ${currency}`);
  });
}

test('money labels follow the currency fractional precision', () => {
  expect(formatSignedMoney(12.345, 'KWD', 3)).toContain('12.345');
  expect(formatSignedMoney(123.45, 'JPY', 0)).not.toContain('.');
  expect(formatSignedMoney(12.34, 'USD')).toBe('+12.34 USD');
});
