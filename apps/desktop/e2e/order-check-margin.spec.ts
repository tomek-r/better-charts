import { test, expect, type Locator, type Page } from '@playwright/test';
import { fillExitPrice, openTradePanel } from './helpers/panel';
import {
  brokerSymbolFixture,
  expectNoErrors,
  gotoWithStub,
  wasInvoked,
  type TauriStubOptions,
} from './helpers/tauriStub';

const eurusd = brokerSymbolFixture('EURUSD', 'Euro / US Dollar', { stopsLevel: 10 });

// The OrderCheck card shows the margin situation AFTER the order fills (an
// estimate that prices the order alone) and the broker's margin-call /
// stop-out thresholds. It warns only: Send stays governed by the existing gates.

/** Opens the review stage with a market buy and returns the OrderCheck card. */
async function reviewCard(page: Page, options: TauriStubOptions) {
  const collected = await gotoWithStub(page, options);
  await openTradePanel(page);
  await page.locator('.ticket-quote-side.buy').click();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Stop loss price').fill('1.0800');
  await page.getByRole('button', { name: 'Start creating order', exact: true }).click();
  const card = page.getByLabel('MT5 OrderCheck result');
  await expect(card).toBeVisible();
  return { card, collected };
}

function cell(card: Locator, label: string): Locator {
  return card.locator('.order-check-grid > div').filter({ has: card.page().getByText(label, { exact: true }) });
}

/** Pending kinds are priced by the EA at their own fill price; the card must show whatever it reports. */
async function reviewPendingOrder(
  page: Page,
  tab: 'Stop Limit' | 'Stop',
  side: 'buy' | 'sell',
  prices: { trigger: string; limit?: string; stopLoss: string },
  orderCheckResult: Record<string, unknown>,
) {
  const collected = await gotoWithStub(page, { symbolInfo: eurusd, orderCheckResult });
  await openTradePanel(page);
  const ticket = page.locator('section.order-ticket');
  await expect(ticket.locator('.ticket-tick-value')).toBeVisible();
  await ticket.locator(`.ticket-quote-side.${side}`).click();
  await ticket.getByRole('button', { name: tab, exact: true }).click();
  await page.getByLabel('Order price').fill(prices.trigger);
  if (prices.limit) {
    await page.getByLabel('Limit price').fill(prices.limit);
  }
  await fillExitPrice(page, 'Stop loss', prices.stopLoss);
  await ticket.locator('.ticket-cta').click();
  const card = page.getByLabel('MT5 OrderCheck result');
  await expect(card).toBeVisible();
  return { card, collected, args: (await wasInvoked(page, 'request_order_check'))?.args };
}

test('Buy Stop Limit review shows the margin the EA priced at the resting limit price', async ({ page }) => {
  const { card, collected, args } = await reviewPendingOrder(
    page,
    'Stop Limit',
    'buy',
    { trigger: '1.09000', limit: '1.08000', stopLoss: '1.07800' },
    { marginAtFill: '216.00', freeMarginAfterFill: '9284.00', marginLevelAfterFill: '1397.21' },
  );
  expect(args).toMatchObject({ orderKind: 'stop_limit', side: 'buy', entry: '1.09000', limitPrice: '1.08000' });
  await expect(cell(card, 'Margin at fill')).toHaveText('Margin at fill216.00 USD');
  await expect(cell(card, 'Free margin after fill')).toHaveText('Free margin after fill9,284.00 USD');
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill1397.21%');
  expectNoErrors(collected);
});

test('Sell Stop review shows the margin the EA priced at the stop entry price', async ({ page }) => {
  const { card, collected, args } = await reviewPendingOrder(
    page,
    'Stop',
    'sell',
    { trigger: '1.08000', stopLoss: '1.08200' },
    { marginAtFill: '108.00', freeMarginAfterFill: '9392.00', marginLevelAfterFill: '1642.86' },
  );
  expect(args).toMatchObject({ orderKind: 'stop', side: 'sell', entry: '1.08000' });
  await expect(cell(card, 'Margin at fill')).toHaveText('Margin at fill108.00 USD');
  await expect(cell(card, 'Free margin after fill')).toHaveText('Free margin after fill9,392.00 USD');
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill1642.86%');
  expectNoErrors(collected);
});

test('Buy Stop Limit review shows dashes when the EA could not price the order', async ({ page }) => {
  const { card, collected } = await reviewPendingOrder(
    page,
    'Stop Limit',
    'buy',
    { trigger: '1.09000', limit: '1.08000', stopLoss: '1.07800' },
    { marginAtFill: null, freeMarginAfterFill: null, marginLevelAfterFill: null, marginRisk: 'unknown' },
  );
  await expect(cell(card, 'Margin at fill')).toHaveText('Margin at fill—');
  await expect(cell(card, 'Free margin after fill')).toHaveText('Free margin after fill—');
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill—');
  expectNoErrors(collected);
});

test('shows margin, free margin and level after the fill with the percent thresholds', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {});
  await expect(cell(card, 'Margin at fill')).toHaveText('Margin at fill105.00 USD');
  await expect(cell(card, 'Free margin after fill')).toHaveText('Free margin after fill9,395.00 USD');
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill1650.83%');
  await expect(card).toContainText('Margin call 100% · Stop out 50%');
  await expect(card).not.toContainText('Estimated at fill');
  // The three MT5 cells are replaced, not duplicated.
  for (const retired of ['Margin', 'Free margin', 'Margin level']) {
    await expect(cell(card, retired)).toHaveCount(0);
  }
  await expect(card.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.ticket-cta.send')).toBeEnabled();
  expectNoErrors(collected);
});

test('below margin call is red but warns only', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {
    orderCheckResult: { marginLevelAfterFill: '80.00', marginRisk: 'below_margin_call' },
  });
  await expect(card.getByRole('status')).toHaveText('Below margin call');
  await expect(cell(card, 'Margin level after fill')).toContainText('80.00%');
  await expect(cell(card, 'Margin level after fill').locator('b')).toHaveClass(/margin-risk-below-margin-call/);
  await expect(page.locator('.ticket-cta.send')).toBeEnabled();
  expectNoErrors(collected);
});

test('below stop out is stronger than below margin call and still warns only', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {
    orderCheckResult: { marginLevelAfterFill: '20.00', marginRisk: 'below_stop_out' },
  });
  const warning = card.getByRole('status');
  await expect(warning).toHaveText('Below stop out');
  await expect(warning).toHaveClass(/margin-risk-below-stop-out/);
  await expect(warning).toHaveCSS('font-weight', '800');
  await expect(cell(card, 'Margin level after fill').locator('b')).toHaveClass(/margin-risk-below-stop-out/);
  await expect(page.locator('.ticket-cta.send')).toBeEnabled();
  expectNoErrors(collected);
});

test('money mode shows the thresholds as account-currency amounts', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {
    accountOverrides: {
      marginCallLevel: '200.00',
      stopOutLevel: '100.00',
      marginLevelsMode: 1,
      marginLevelsUnit: 'money',
    },
  });
  await expect(card).toContainText('Margin call 200.00 USD · Stop out 100.00 USD');
  expectNoErrors(collected);
});

test('a check MT5 did not evaluate (retcode 10027, zeroed result) shows no stop-out warning', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {
    orderCheckResult: {
      checkPassed: false,
      retcode: 10027,
      equity: '0.00',
      marginLevel: '0',
      comment: 'AutoTrading disabled by client',
      // Projection from the account sample, as the Rust boundary derives it.
      marginAtFill: '1455.58',
      freeMarginAfterFill: '3845.84',
      marginLevelAfterFill: '364.21',
      marginRisk: 'ok',
    },
  });
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill364.21%');
  await expect(cell(card, 'Margin level after fill').locator('b')).not.toHaveClass(/margin-risk/);
  await expect(cell(card, 'Free margin after fill').locator('b')).not.toHaveClass(/margin-risk/);
  await expect(card).not.toContainText('Below stop out');
  await expect(card.getByRole('status')).toHaveCount(0);
  expectNoErrors(collected);
});

test('unknown projection and thresholds render as dashes, never zero', async ({ page }) => {
  const { card, collected } = await reviewCard(page, {
    accountOverrides: {
      marginCallLevel: null,
      stopOutLevel: null,
      marginLevelsMode: null,
      marginLevelsUnit: 'unknown',
    },
    orderCheckResult: {
      marginAtFill: null,
      freeMarginAfterFill: null,
      marginLevelAfterFill: null,
      marginRisk: 'unknown',
    },
  });
  await expect(cell(card, 'Margin at fill')).toHaveText('Margin at fill—');
  await expect(cell(card, 'Free margin after fill')).toHaveText('Free margin after fill—');
  await expect(cell(card, 'Margin level after fill')).toHaveText('Margin level after fill—');
  await expect(card).toContainText('Margin call — · Stop out —');
  await expect(card.getByRole('status')).toHaveCount(0);
  expectNoErrors(collected);
});
