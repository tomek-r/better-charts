import { expect, test } from '@playwright/test';
import type { BrokerSymbol } from '../src/shared/bridge/types';
import { openTradePanel } from './panel';
import { gotoWithStub } from './tauriStub';

const instrument: BrokerSymbol = {
  symbol: 'EURUSD',
  description: 'Euro / US Dollar',
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  contractSize: '100000',
  tickValueProfit: '1.00000',
  tickValueLoss: '1.00000',
  tickValueCurrency: 'USD',
  volumeMin: '0.01',
  volumeMax: '100',
  volumeStep: '0.01',
  stopsLevel: 10,
  freezeLevel: 0,
  fillingMode: 0,
  orderMode: 0,
  expirationMode: 0,
  tradeExecution: 0,
  tradeMode: 0,
};

test('exit tick display follows the current pending entry in the same rendered state', async ({ page }) => {
  await gotoWithStub(page, { symbolInfo: instrument });
  await openTradePanel(page);

  const ticket = page.locator('section.order-ticket');
  await expect(ticket.getByLabel('Take profit enabled')).toBeVisible();
  await ticket.locator('.ticket-quote-side.buy').click();
  await ticket.getByRole('button', { name: 'Limit', exact: true }).click();

  await page.getByLabel('Order price').fill('1.08000');
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Swap Take profit input to price').click();
  await page.getByLabel('Take profit price').fill('1.08200');
  await page.getByLabel('Swap Take profit input to ticks').click();

  const ticks = page.getByLabel('Take profit ticks');
  await expect(ticks).toHaveValue('200');

  await page.getByLabel('Order price').fill('1.08100');
  await expect(ticks).toHaveValue('100');
});
