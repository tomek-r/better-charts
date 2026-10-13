import { expect, test, type Page } from '@playwright/test';
import { fillExitPrice, openTradePanel } from './helpers/panel';
import {
  brokerSymbolFixture,
  eurusdQuote,
  gotoWithStub,
  pushEvent,
  STUB_NOW,
  stubInvocations,
  wasInvoked,
} from './helpers/tauriStub';

// Owner decision: when the market reaches a Stop entry the review stays blocked with specific guidance
// and a one-click move to the nearest valid trigger. Nothing is auto-sent or auto-converted.
const eurusd = brokerSymbolFixture('EURUSD', 'Euro / US Dollar', { stopsLevel: 10 });
const EA_REJECTION = 'stop entry must be above ask for buy or below bid for sell';
// Long enough to inspect the review before the stub answers; the passed-entry error arrives first.
const CHECK_DELAY_MS = 1500;
const BID = '1.0852';
const ASK = '1.0854';

async function checkRequests(page: Page) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_order_check');
}

/** Starts a Stop review at the market price; the stub answers the check after CHECK_DELAY_MS. */
async function startStopReview(page: Page, side: 'buy' | 'sell', entry: string, stopLoss: string) {
  await gotoWithStub(page, { symbolInfo: eurusd, orderCheckDelayMs: CHECK_DELAY_MS });
  await openTradePanel(page);
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 1000, BID, ASK));
  const ticket = page.locator('section.order-ticket');
  await ticket.locator(`.ticket-quote-side.${side}`).click();
  await ticket.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByLabel('Order price').fill(entry);
  await fillExitPrice(page, 'Stop loss', stopLoss);
  await ticket.locator('.ticket-cta').click();
  await expect.poll(async () => (await checkRequests(page)).length).toBe(1);
}

/** Reviews a Stop at the market price, then makes the EA reject it as already passed. */
async function reviewPassedStop(page: Page, side: 'buy' | 'sell', entry: string, stopLoss: string) {
  await startStopReview(page, side, entry, stopLoss);
  const { draftVersion } = (await checkRequests(page))[0].args as { draftVersion: number };
  await pushEvent(page, 'order-check-error', {
    draftVersion,
    draftId: 'draft-001',
    code: 'INVALID_PRICE',
    message: EA_REJECTION,
  });
  return page.locator('.notification-region [role=alert]');
}

async function expectMoveLeavesReviewUntilFreshCheck(page: Page, action: string, movedEntry: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page.locator('.ticket-review-head')).toHaveCount(0);
  await expect(page.getByLabel('Order price')).toHaveValue(movedEntry);
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
  expect(await checkRequests(page)).toHaveLength(1);
  await page.locator('section.order-ticket .ticket-cta').click();
  const send = page.locator('.ticket-cta.send');
  await expect(send).toBeDisabled();
  await expect(send).toHaveText('Checking with MT5…');
  await expect(send).toBeEnabled();
  expect(await checkRequests(page)).toHaveLength(2);
  expect((await checkRequests(page))[1].args).toMatchObject({ entry: movedEntry });
  expect(await wasInvoked(page, 'submit_order')).toBeUndefined();
}

function figure(page: Page, label: string) {
  return page
    .getByLabel('MT5 OrderCheck result')
    .locator('.order-check-grid > div')
    .filter({ has: page.getByText(label, { exact: true }) });
}

test('the order data block shows placeholders while checking, then fills in without changing height', async ({
  page,
}) => {
  await startStopReview(page, 'buy', '1.0860', '1.0830');
  const card = page.getByLabel('MT5 OrderCheck result');
  await expect(card).toBeVisible();
  await expect(figure(page, 'Margin at fill')).toHaveText('Margin at fill—');
  await expect(figure(page, 'Free margin after fill')).toHaveText('Free margin after fill—');
  await expect(figure(page, 'Margin level after fill')).toHaveText('Margin level after fill—');
  await expect(figure(page, 'Requested entry')).toHaveText('Requested entry1.0860');
  await expect(figure(page, 'Stop loss')).toHaveText('Stop loss1.0830');
  await expect(figure(page, 'Units')).not.toHaveText('Units—');
  // No check time before MT5 has checked; its row stays reserved so the card does not jump.
  await expect(card).not.toContainText('Checked');
  await expect(card.locator('.order-check-time')).toBeHidden();
  const loadingHeight = (await card.boundingBox())?.height;
  await expect(page.locator('.ticket-cta.send')).toBeEnabled();
  await expect(card.locator('.order-check-time')).toHaveText(/^Checked [^·]+$/);
  await expect(figure(page, 'Margin at fill')).toHaveText('Margin at fill105.00 USD');
  expect((await card.boundingBox())?.height).toBe(loadingHeight);
});

test('a Buy Stop the market reached explains it and moves above Ask by the stops level', async ({ page }) => {
  const alerts = await reviewPassedStop(page, 'buy', ASK, '1.0830');
  await expect(figure(page, 'Margin at fill')).toHaveText('Margin at fill—');
  await expect(figure(page, 'Requested entry')).toHaveText(`Requested entry${ASK}`);
  await expect(alerts).toHaveCount(1);
  await expect(alerts).toContainText(
    `Price moved past your stop entry (Ask ${ASK}). Move the entry above Ask or switch to Market.`,
  );
  await expect(alerts).not.toContainText('must be above ask');
  await expect(page.locator('section.order-ticket')).not.toContainText('Price moved past');
  await expect(page.locator('.ticket-cta.send')).toBeDisabled();
  // Ask 1.0854 + stops level 10 points (0.00010) = 1.0855.
  await expectMoveLeavesReviewUntilFreshCheck(page, 'Move entry above Ask', '1.0855');
});

test('the passed-entry notice updates the live Ask in place instead of remounting on each quote', async ({ page }) => {
  const alerts = await reviewPassedStop(page, 'buy', ASK, '1.0830');
  await expect(alerts).toHaveCount(1);
  await alerts.evaluate((element) => {
    (element as HTMLElement).dataset.mountMarker = 'original';
  });
  const nextAsks = ['1.0856', '1.0857', '1.0858'];
  for (const [index, ask] of nextAsks.entries()) {
    await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 2000 + index, '1.0852', ask));
    await expect(alerts).toContainText(`(Ask ${ask})`);
  }
  await expect(alerts).toHaveCount(1);
  await expect(alerts).toHaveAttribute('data-mount-marker', 'original');
});

test('a Sell Stop the market reached explains it and moves below Bid by the stops level', async ({ page }) => {
  const alerts = await reviewPassedStop(page, 'sell', BID, '1.0870');
  await expect(alerts).toHaveCount(1);
  await expect(alerts).toContainText(
    `Price moved past your stop entry (Bid ${BID}). Move the entry below Bid or switch to Market.`,
  );
  await expect(alerts).not.toContainText('must be above ask');
  await expect(page.locator('.ticket-cta.send')).toBeDisabled();
  await expectMoveLeavesReviewUntilFreshCheck(page, 'Move entry below Bid', '1.0851');
});
