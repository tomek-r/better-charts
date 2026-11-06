import type { Locator, Page } from '@playwright/test';

/** Moves between the press and the release, so the panel follows a pointer that walks rather than jumps. */
const DRAG_STEPS = 5;

/**
 * Drags `handle` by `dx`, `dy` with the mouse: presses the middle of the handle, walks the pointer by the
 * offset and releases. The caller reads the panel's box itself, before and after, to assert where the drag
 * left it.
 */
export async function dragBy(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const box = await handle.boundingBox();
  if (box === null) {
    throw new Error('The drag handle is not laid out.');
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: DRAG_STEPS });
  await page.mouse.up();
}
