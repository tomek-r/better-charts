import type { Locator, Page } from '@playwright/test';

/** The notice at the bottom right that reports `message`, whichever surface raised it. */
export function bridgeNotice(page: Page, message: string): Locator {
  return page.locator('.notification-region [role=alert]').filter({ hasText: message });
}
