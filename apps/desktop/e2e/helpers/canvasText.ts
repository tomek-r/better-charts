import type { Page } from '@playwright/test';

type FillTextObserver = (context: CanvasRenderingContext2D, text: string, x: number, y: number) => void;

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
      observe(this, text, x, y);
      if (maxWidth === undefined) {
        fillText.call(this, text, x, y);
      } else {
        fillText.call(this, text, x, y, maxWidth);
      }
    };
  };
  await page.addInitScript(`(${install.toString()})(${createObserver.toString()})`);
}

/** One `fillText` on the price-axis canvas, stamped with the frame's time. */
export interface AxisPaint {
  text: string;
  at: number;
  x: number;
  y: number;
}

/** A tag's text rebuilt from its glyph draws, with the x of its first glyph. */
export interface GlyphRow extends AxisPaint {
  /** x of every glyph, left to right. */
  glyphXs: number[];
}

/**
 * The price-axis tags draw one glyph per cell, so their text is reassembled per
 * frame and row: single-character draws sharing a y, ordered by x (one glyph per
 * x, in case a frame is painted twice). Tick labels are longer strings and never
 * match.
 */
export function assembleGlyphRows(paints: AxisPaint[]): GlyphRow[] {
  const rows = new Map<string, { at: number; y: number; glyphs: Map<number, string> }>();
  for (const paint of paints) {
    if (paint.text.length === 1) {
      const key = `${paint.at}|${paint.y}`;
      const row = rows.get(key) ?? { at: paint.at, y: paint.y, glyphs: new Map<number, string>() };
      row.glyphs.set(paint.x, paint.text);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map(({ at, y, glyphs }) => {
    const ordered = [...glyphs.entries()].sort(([left], [right]) => left - right);
    return {
      at,
      y,
      x: ordered[0][0],
      text: ordered.map(([, glyph]) => glyph).join(''),
      glyphXs: ordered.map(([x]) => x),
    };
  });
}
