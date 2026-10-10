import type { Page } from '@playwright/test';

type FillTextObserver = (context: CanvasRenderingContext2D, text: string, x: number) => void;

/**
 * Observes every `fillText` the page's canvases paint, before the real draw. The
 * chart paints its own axis and labels, so specs read the canvas instead of
 * exposing chart objects. `createObserver` runs once in the page, before any
 * app script, so it can create the state it records into; it must not close over
 * test-side variables because it is serialised.
 */
export async function observeFillText(page: Page, createObserver: () => FillTextObserver): Promise<void> {
  const install = (create: () => FillTextObserver) => {
    const observe = create();
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      observe(this, text, x);
      if (maxWidth === undefined) {
        fillText.call(this, text, x, y);
      } else {
        fillText.call(this, text, x, y, maxWidth);
      }
    };
  };
  await page.addInitScript(`(${install.toString()})(${createObserver.toString()})`);
}
