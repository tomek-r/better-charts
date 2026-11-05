import { expect, test, type Page } from '@playwright/test';

/** The buffer an init script keeps on the page: what the browser complained about while the spec ran. */
type NoiseWindow = Window & { __pageNoise?: string[] };

/**
 * Records what the browser complained about while the spec ran: the suite's own assertions do not see the
 * console, so a spec has to read the buffer back to fail on the noise.
 */
export async function recordPageNoise(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const noise: string[] = [];
    (window as unknown as NoiseWindow).__pageNoise = noise;
    const consoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      noise.push(args.map((arg) => String(arg)).join(' '));
      consoleError(...args);
    };
    window.addEventListener('error', (event) => {
      noise.push(event.message);
    });
  });
}

/** Everything {@link recordPageNoise} collected, in the order the browser printed it. */
export async function pageNoise(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as NoiseWindow).__pageNoise ?? []);
}

/**
 * Registers both hooks: call it at the top of a spec or `describe` whose tests must leave the browser console clean.
 */
export function failOnPageNoise(): void {
  test.beforeEach(({ page }) => recordPageNoise(page));
  test.afterEach(async ({ page }) => {
    expect(await pageNoise(page)).toEqual([]);
  });
}
