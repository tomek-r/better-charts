import type { Page } from '@playwright/test';

/** What the chart draws of its scales settings right now. */
export function chartScalesState(page: Page) {
  return page.evaluate(() => window.__chartTest!.scales());
}
