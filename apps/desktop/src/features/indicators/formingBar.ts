import type { RenderBar } from '../chart/engine/bars/renderBar';

/**
 * Remembers which bar the chart is still drawing.
 *
 * A chart re-sends the newest bar on every tick and only moves on to the next bar once the current
 * one closes. An indicator therefore cannot treat every incoming bar as new: a repeated time is a
 * tick of the forming bar (recompute it, replace what was drawn), while a newer time means the
 * previously forming bar is final and must be committed before the new one starts forming.
 */
export class FormingBar {
  private bar: RenderBar | null = null;

  reset(): void {
    this.bar = null;
  }

  isBehind(bar: RenderBar): boolean {
    return this.bar !== null && bar.time < this.bar.time;
  }

  adopt(bar: RenderBar): RenderBar | null {
    const closedBar = this.bar;
    this.bar = bar;
    if (closedBar === null || closedBar.time === bar.time) {
      return null;
    }
    return closedBar;
  }
}
