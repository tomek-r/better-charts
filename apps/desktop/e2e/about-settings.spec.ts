import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoWithStub, stubInvocations } from './helpers/tauriStub';

const ABOUT_LINKS = [
  { name: 'Apache License 2.0', url: 'https://github.com/tradingview/lightweight-charts/blob/master/LICENSE' },
  { name: 'tradingview.com', url: 'https://www.tradingview.com/' },
];

/** The opener plugin answers nothing; the stub must still script that answer or it rejects the call. */
const OPENER_RESPONSES = { 'plugin:opener|open_url': null };

async function openAboutTab(page: Page): Promise<Locator> {
  await gotoWithStub(page, { responses: OPENER_RESPONSES });
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('button', { name: 'About', exact: true }).click();
  return dialog;
}

/** The addresses the webview handed to the opener plugin, in click order. */
async function openedUrls(page: Page): Promise<string[]> {
  const invocations = await stubInvocations(page);
  return invocations
    .filter((invocation) => invocation.cmd === 'plugin:opener|open_url')
    .map((invocation) => String(invocation.args.url));
}

test('About credits TradingView Lightweight Charts', async ({ page }) => {
  const dialog = await openAboutTab(page);

  await expect(dialog).toContainText('TradingView Lightweight Charts™ Copyright © 2025 TradingView, Inc.');
  for (const { name } of ABOUT_LINKS) {
    await expect(dialog.getByRole('link', { name, exact: true })).toBeVisible();
  }
});

test('About links open in the system browser and the app stays on its page', async ({ page }) => {
  const dialog = await openAboutTab(page);
  const appUrl = page.url();

  for (const { name, url } of ABOUT_LINKS) {
    await dialog.getByRole('link', { name, exact: true }).click();
    await expect.poll(() => openedUrls(page)).toContain(url);
  }

  expect(page.url()).toBe(appUrl);
});
