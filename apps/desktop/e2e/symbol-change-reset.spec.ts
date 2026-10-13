import { expect, test, type Page } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch, openTradePanel } from './helpers/panel';
import { stagedState } from './helpers/stagedWidget';
import { brokerSymbolFixture, gotoWithStub, pushEvent, windowCandles } from './helpers/tauriStub';

/** Stages a Buy limit with SL and TP, then starts the OrderCheck review. */
async function stageLimitAndCheck(page: Page): Promise<void> {
  await openTradePanel(page);
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await expect.poll(() => stagedState(page)).toBe(true);
  const limitTab = page.locator('section.order-ticket .ticket-type-tab', { hasText: 'Limit' }).first();
  await limitTab.click();
  await expect(limitTab).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Order price').fill('1.0800');
  // A limit order's exits are already in price mode.
  await page.getByLabel('Take profit enabled').check();
  await page.getByLabel('Take profit price').fill('1.0900');
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0750');
  const cta = page.locator('.ticket-cta');
  await expect(cta).toBeEnabled();
  await cta.click();
}

async function switchSymbol(page: Page, symbol: string): Promise<void> {
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, symbol, [brokerSymbolFixture(symbol, `${symbol} description`)]);
  await chooseSearchResult(dialog, symbol);
  await expect(page.locator('.chart-heading h1')).toHaveText(symbol);
}

async function expectTicketAtDefaults(page: Page): Promise<void> {
  await expect.poll(() => stagedState(page)).toBe(false);
  await expect(page.locator('section.order-ticket .ticket-type-tab', { hasText: 'Market' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Stop loss enabled')).not.toBeChecked();
  await expect(page.getByLabel('Take profit enabled')).not.toBeChecked();
  await expect(page.locator('.order-check-result')).toHaveCount(0);
  await expect(page.locator('.ticket-cta.send')).toHaveCount(0);
}

test('switching the symbol resets the staged order, draft, review and volume to the new symbol defaults', async ({
  page,
}) => {
  await gotoWithStub(page);
  await stageLimitAndCheck(page);
  await expect(page.locator('.order-check-result')).toBeVisible();

  await switchSymbol(page, 'NAS100');
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('NAS100', 'NAS100 description', { volumeMin: '0.1' }));

  await expectTicketAtDefaults(page);
  await expect(page.getByLabel('Units')).toHaveValue('0.1');
});

test('a timeframe change keeps the draft and the review', async ({ page }) => {
  await gotoWithStub(page);
  await stageLimitAndCheck(page);
  await expect(page.locator('.order-check-result')).toBeVisible();

  await pushEvent(page, 'market-snapshot', {
    symbol: 'EURUSD',
    timeframe: 'M15',
    complete: true,
    candles: windowCandles(10),
  });
  await page.waitForTimeout(300);

  await expect(page.locator('.order-check-result')).toBeVisible();
  await expect(page.locator('.order-check-grid')).toContainText('1.0750');
});

test('an OrderCheck reply for the old symbol that lands after the switch is ignored', async ({ page }) => {
  await gotoWithStub(page, { orderCheckDelayMs: 700 });
  await stageLimitAndCheck(page);

  await switchSymbol(page, 'NAS100');
  await page.waitForTimeout(1000);

  await expectTicketAtDefaults(page);
});
