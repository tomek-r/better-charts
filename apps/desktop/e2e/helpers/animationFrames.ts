import type { Page } from '@playwright/test';

/** Waits for the page's next two animation frames, so a screenshot shows what the page has just been given. */
export async function waitTwoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}
