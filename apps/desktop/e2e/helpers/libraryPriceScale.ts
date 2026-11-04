import type { Page } from '@playwright/test';

/** The price scale as the library holds it, read back through the DEV test hook. */
export function libraryPriceScale(page: Page) {
  return page.evaluate(() => window.__chartTest!.priceScale());
}
