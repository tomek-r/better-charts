import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent, stubInvocations } from './tauriStub';
import { openTradePanel } from './panel';

const account = {
  accountLogin: '50123456',
  brokerServer: 'Broker-Demo',
  currency: 'USD',
  currencyDigits: 2,
  balance: '5326.76',
  equity: '5315.69',
  margin: '307.85',
  freeMargin: '5007.84',
  marginLevel: '1726.71',
  leverage: 100,
  marginMode: 2,
  tradeAllowed: true,
  expertAllowed: true,
};

test('account summary stays visible without positions and aligns its labels and values', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { pageErrors, consoleErrors } = await gotoWithStub(page, { responses: { get_account_snapshot: account } });
  await openTradePanel(page);
  const summary = page.locator('.portfolio-account');
  await expect(summary).toBeVisible();
  await expect(page.locator('.portfolio-row')).toHaveCount(0);
  await expect(summary.locator('dt')).toHaveText(['Balance', 'Equity', 'Margin', 'Free margin', 'Margin level']);
  await expect(summary.locator('dd')).toHaveText([
    '5,326.76 USD',
    '5,315.69 USD',
    '307.85 USD',
    '5,007.84 USD',
    '1,726.71 %',
  ]);
  const geometry = await summary.evaluate((element) => ({
    labels: Array.from(element.querySelectorAll('dt'), (node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }),
    values: Array.from(element.querySelectorAll('dd'), (node) => {
      const rect = node.getBoundingClientRect();
      return { right: rect.right, top: rect.top };
    }),
  }));
  geometry.labels.forEach((label, index) => {
    expect(label.left).toBeCloseTo(geometry.labels[0].left, 0);
    expect(label.top).toBeCloseTo(geometry.values[index].top, 0);
    expect(geometry.values[index].right).toBeCloseTo(geometry.values[0].right, 0);
  });
  await summary.screenshot({ path: testInfo.outputPath('account-summary.png') });
  await pushEvent(page, 'account-snapshot', { ...account, currency: 'KWD', currencyDigits: 3, equity: '5300.123' });
  await expect(summary.locator('dd').nth(1)).toHaveText('5,300.123 KWD');
  await expect(summary.locator('dd').nth(4)).toHaveText('1,726.71 %');
  expect((await stubInvocations(page)).filter(({ cmd }) => cmd === 'submit_order')).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('account summary has placeholders while account and portfolio are unavailable', async ({ page }) => {
  await gotoWithStub(page, { responses: { get_account_snapshot: null, get_portfolio_snapshot: null } });
  await openTradePanel(page);
  const summary = page.locator('.portfolio-account');
  await expect(summary).toBeVisible();
  await expect(summary.locator('dd')).toHaveText(['—', '—', '—', '—', '—']);
});
