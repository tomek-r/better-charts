import type { Page } from '@playwright/test';

/**
 * The chart's own DOM as the specs drive it: the host the library draws in, and the resize handle it puts on
 * the separator between two panes, which the pointer drags to resize them.
 */

/** The element the chart is drawn in. */
export const CHART_HOST_SELECTOR = '.chart-host';

/** The library's resize handle on the pane separator; its full-window drag backdrop is the fixed one. */
export const RESIZE_HANDLE_SELECTOR = '.chart-host td[colspan="3"] > div[style*="position: absolute"]';

/** Where the pointer grabs the separator between two panes: the centre of its resize handle. */
export async function paneSeparatorCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(RESIZE_HANDLE_SELECTOR).boundingBox();
  if (box === null) {
    throw new Error('The pane separator has no resize handle.');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
