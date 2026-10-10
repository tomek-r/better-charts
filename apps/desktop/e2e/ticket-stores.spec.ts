import { expect, test } from '@playwright/test';
import { openTradePanel } from './helpers/panel';
import { brokerSymbolFixture, gotoWithStub } from './helpers/tauriStub';

const instrument = brokerSymbolFixture('EURUSD', 'Euro / US Dollar', { stopsLevel: 10 });

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
