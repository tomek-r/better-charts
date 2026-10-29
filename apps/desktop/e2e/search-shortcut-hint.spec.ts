import { expect, test } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

const HINTS = [
  { platform: 'macos', hint: '⌘K' },
  { platform: 'windows', hint: 'Ctrl+K' },
  { platform: 'linux', hint: 'Ctrl+K' },
] as const;

for (const { platform, hint } of HINTS) {
  test(`the search button hints ${hint} on ${platform}`, async ({ page }) => {
    await gotoWithStub(page, { platform });
    await expect(page.locator('.search-trigger kbd')).toHaveText(hint);
  });
}
