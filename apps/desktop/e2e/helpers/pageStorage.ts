import type { Page } from '@playwright/test';

/** The page's own storage, reached from a spec: seeding it before the app loads and reading it back. */

/** Writes one raw value under `key` before the app loads, once, so a reload keeps what the app stored. */
export async function seedStoredValue(page: Page, key: string, raw: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
      }
    },
    { key, value: raw },
  );
}

/** The JSON stored under `key`, as the app left it; nothing stored reads as an empty object. */
export async function readStoredJson(page: Page, key: string): Promise<unknown> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? '{}') as unknown, key);
}
