import { expect, type Page } from '@playwright/test';

/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;

/** Waits for the stub's bars, so the chart has candles to scale. */
export async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}
