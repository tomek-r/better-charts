import { expect, test, type Page } from '@playwright/test';
import { eurusdQuote, pushEvent, STUB_NOW } from './helpers/tauriStub';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { openTradePanel } from './helpers/panel';

// Stub quote: bid 1.0846 / ask 1.0850, EURUSD tick 0.00001, broker minimum 20 ticks.
// A SELL stop sits above the ask by more than the minimum, a BUY stop below the bid.
const sellSide = (page: Page) => page.locator('section.order-ticket .ticket-quote-side.sell');
const buySide = (page: Page) => page.locator('section.order-ticket .ticket-quote-side.buy');

async function openRiskTicket(page: Page) {
  await gotoRiskBandStub(page);
  await openTradePanel(page);
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Swap Stop loss input to price').click();
}
const stopLoss = async (page: Page) => Number(await page.getByLabel('Stop loss price').inputValue());

test('a typed SELL stop below the entry snaps to the Min SL edge above the ask on blur', async ({ page }) => {
  await openRiskTicket(page);
  await sellSide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  const input = page.getByLabel('Stop loss price');
  await input.fill('1.0840');
  // Mid-edit the typed text is left alone.
  await expect(input).toHaveValue('1.0840');
  await input.blur();
  await expect(input).toHaveValue('1.08521');
});

test('Enter commits a too-close BUY stop to the Min SL edge, a too-far one to the Max SL edge', async ({ page }) => {
  await openRiskTicket(page);
  await buySide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  const input = page.getByLabel('Stop loss price');
  await input.fill('1.0845');
  await input.press('Enter');
  await expect(input).toHaveValue('1.08439');
  await input.fill('1.0700');
  await input.press('Enter');
  await expect(input).toHaveValue('1.08396');
});

test('a stop inside the band is left alone by quote ticks that keep it inside', async ({ page }) => {
  await openRiskTicket(page);
  await buySide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  const input = page.getByLabel('Stop loss price');
  await input.fill('1.0841');
  await input.blur();
  await expect(input).toHaveValue('1.0841');
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 1000, '1.0847', '1.0851'));
  await expect(page.locator('.ticket-quote-side.buy')).toContainText('1.0851');
  // The follow translates the stop by the entry move (1 pip); nothing snaps it.
  await expect(input).toHaveValue('1.0842');
});

test('units mode has no band: a wrong-side stop is not snapped', async ({ page }) => {
  await gotoRiskBandStub(page);
  await openTradePanel(page);
  await buySide(page).click();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Swap Stop loss input to price').click();
  const input = page.getByLabel('Stop loss price');
  await input.fill('1.0870');
  await input.blur();
  await expect(input).toHaveValue('1.0870');
});

test('a staged SELL draft is seeded with a stop above the ask', async ({ page }) => {
  await openRiskTicket(page);
  await sellSide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  await expect.poll(() => stopLoss(page)).toBeGreaterThan(1.0852);
});

test('switching from a BUY draft to SELL re-seeds the stop above the ask', async ({ page }) => {
  await openRiskTicket(page);
  await buySide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  await expect.poll(() => stopLoss(page)).toBeLessThan(1.0844);
  await sellSide(page).click();
  await expect.poll(() => stopLoss(page)).toBeGreaterThan(1.0852);
});

test('a SELL stop switched off while the market rises is not stale when switched back on', async ({ page }) => {
  await openRiskTicket(page);
  await sellSide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  await expect.poll(() => stopLoss(page)).toBeGreaterThan(1.0852);
  await page.getByLabel('Stop loss enabled').uncheck();
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 1000, '1.0900', '1.0904'));
  await expect(page.locator('.ticket-quote-side.sell')).toContainText('1.0900');
  await page.getByLabel('Stop loss enabled').check();
  await expect.poll(() => stopLoss(page)).toBeGreaterThan(1.0904 + 0.0002);
});

test('a SELL stop stays above the ask through quote ticks and a spread change', async ({ page }) => {
  await openRiskTicket(page);
  await sellSide(page).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  await expect.poll(() => stopLoss(page)).toBeGreaterThan(1.0852);
  for (const [bid, ask] of [
    ['1.0849', '1.0856'],
    ['1.0848', '1.0849'],
    ['1.0850', '1.0857'],
  ]) {
    await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 1000, bid, ask));
    await expect.poll(async () => (await stopLoss(page)) - Number(ask)).toBeGreaterThan(0.0002);
  }
});
