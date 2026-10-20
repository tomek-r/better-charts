import { test, expect } from '@playwright/test';
import { accountEnvironment } from '../src/features/order-ticket/domain/ticketFormatting';
import { openTradePanel } from './helpers/panel';
import { gotoWithStub } from './helpers/tauriStub';

test('the account badge names the broker company after the account number when the EA reports it', () => {
  const reported = accountEnvironment({
    accountTradeModeName: 'real',
    accountLogin: '109451',
    accountCompany: 'Raw Trading Ltd',
  });
  expect(reported.labelParts).toEqual(['REAL', '109451', 'Raw Trading Ltd']);
  // An older EA or an empty name reports no company: the badge keeps its two parts.
  for (const accountCompany of [undefined, null, '']) {
    expect(
      accountEnvironment({ accountTradeModeName: 'real', accountLogin: '109451', accountCompany }).labelParts,
    ).toEqual(['REAL', '109451']);
  }
});

test('the ticket badge shows the broker company from the account snapshot', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      // Only the fields the badge reads; the frontend normalizer fills the rest.
      get_account_snapshot: {
        accountLogin: '50123456',
        accountTradeModeName: 'demo',
        accountCompany: 'Raw Trading Ltd',
        currency: 'USD',
      },
    },
  });
  // The trade panel is a drawer, closed by default; the badge lives in it.
  await openTradePanel(page);
  await expect(page.locator('.ticket-title .ticket-account-badge')).toHaveText(/^DEMO\s*50123456\s*Raw Trading Ltd$/);
});
