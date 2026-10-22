import { test, expect, type Locator } from '@playwright/test';
import { accountEnvironment } from '../src/features/account-badge/accountEnvironment';
import { gotoWithStub } from './helpers/tauriStub';

test('the account badge names the broker company before the account number when the EA reports it', () => {
  const reported = accountEnvironment({
    accountTradeModeName: 'real',
    accountLogin: '109451',
    accountCompany: 'Raw Trading Ltd',
  });
  expect(reported.labelParts).toEqual(['Raw Trading Ltd', '109451', 'Real']);
  // An older EA or an empty name reports no company: the badge keeps its two parts.
  for (const accountCompany of [undefined, null, '']) {
    expect(
      accountEnvironment({ accountTradeModeName: 'real', accountLogin: '109451', accountCompany }).labelParts,
    ).toEqual(['109451', 'Real']);
  }
});

test('the top bar badge shows the broker company left of the search button', async ({ page }) => {
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
  // The trade panel is a drawer, closed by default — the badge must not depend on it.
  await expect(page.locator('aside.trade-panel')).toBeHidden();
  const badge = page.locator('.topbar-actions .account-badge');
  await expect(badge).toHaveText(/^Raw Trading Ltd 50123456 Demo$/);
  await expect(badge.locator('.account-badge-icon:not(.account-badge-bank)')).toBeVisible();
  await expect(badge.locator('.account-badge-bank')).toBeVisible();
  // It sits directly LEFT of the symbol search, centred on the same row.
  const badgeBox = (await badge.boundingBox())!;
  const searchBox = (await page.getByRole('button', { name: 'Search symbols' }).boundingBox())!;
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(searchBox.x);
  expect(Math.abs(badgeBox.y + badgeBox.height / 2 - (searchBox.y + searchBox.height / 2))).toBeLessThanOrEqual(1);
});

test('the bank icon is absent when the EA reports no company', async ({ page }) => {
  await gotoWithStub(page, {
    responses: { get_account_snapshot: { accountLogin: '50123456', accountCompany: null } },
  });
  const badge = page.locator('.topbar-actions .account-badge');
  await expect(badge.locator('.account-badge-icon')).toBeVisible();
  await expect(badge.locator('.account-badge-bank')).toHaveCount(0);
});

test('the kind word keeps the badge colour and every kind carries the money icon', async ({ page }) => {
  await gotoWithStub(page);
  const badge = page.locator('.topbar-actions .account-badge');
  // The default stub reports a demo account: the kind word names the environment, it is not coloured by it.
  const kind = badge.locator('.account-badge-kind');
  await expect(kind).toHaveText('Demo');
  await expect(kind.locator('.account-badge-money')).toBeVisible();
  const colourOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).color);
  expect(await colourOf(kind)).toBe(await colourOf(badge));
});
