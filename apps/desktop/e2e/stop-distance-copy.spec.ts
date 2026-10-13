import { expect, test } from '@playwright/test';
import { pushEvent, stubInvocations } from './helpers/tauriStub';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { openTradePanel } from './helpers/panel';

// Owner decision: the stop-distance rule still blocks the order, but it no longer prints
// "stop_loss too close: distance … required >= …" on the ticket or as an error toast.
const TOO_CLOSE = /too close/i;
const brokerWording = 'stop_loss too close: distance 0.06, required >= 0.20 (20 ticks margin)';

test('a too-close stop in Units mode keeps Start creating order disabled without any "too close" copy', async ({
  page,
}) => {
  await gotoRiskBandStub(page);
  await openTradePanel(page);
  // Stub quote bid 1.0846: a BUY stop 10 ticks below the bid is inside the 20 tick minimum.
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await page.getByLabel('Stop loss enabled').check();
  await page.getByLabel('Swap Stop loss input to price').click();
  await page.getByLabel('Stop loss price').fill('1.0845');
  await page.getByLabel('Stop loss price').blur();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.0845');
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
  await expect(page.locator('section.order-ticket')).not.toContainText(TOO_CLOSE);
  await expect(page.locator('.notification-region')).not.toContainText(TOO_CLOSE);
});

test('the broker stop-distance rejection raises no toast while other sizing errors still do', async ({ page }) => {
  await gotoRiskBandStub(page);
  await openTradePanel(page);
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Risk, % equity' }).click();
  await page.getByLabel('Risk percent', { exact: true }).fill('5');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_risk_preview').length)
    .toBeGreaterThan(0);
  const request = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_risk_preview').at(-1)!;
  const { draftVersion } = request.args as { draftVersion: number };
  await pushEvent(page, 'risk-preview-error', { draftVersion, message: brokerWording });
  await pushEvent(page, 'order-check-error', { draftVersion, message: brokerWording });
  await page.waitForTimeout(300);
  await expect(page.locator('.notification-region')).not.toContainText(TOO_CLOSE);
  // Control: any other broker error is still reported.
  await pushEvent(page, 'risk-preview-error', { draftVersion, message: 'Risk preview rejected by the broker.' });
  await expect(page.locator('.notification-region')).toContainText('Risk preview rejected by the broker.');
});
