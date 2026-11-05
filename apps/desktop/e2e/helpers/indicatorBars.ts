import type { RenderBar } from '../../src/features/chart/engine/bars/renderBar';

export const FIRST_BAR_TIME = 1_700_000_000;
export const BAR_SPACING_SECONDS = 300;
export const MILLISECONDS_PER_SECOND = 1000;

/** A bar one `BAR_SPACING_SECONDS` later than the bar before it, so its index also dates it. */
export function barAt(index: number, close: number, high = close, low = close): RenderBar {
  return {
    time: FIRST_BAR_TIME + index * BAR_SPACING_SECONDS,
    open: close,
    high,
    low,
    close,
    volume: 0,
  };
}

/** One bar per close, in the order the closes are given. */
export function barsFromCloses(closes: readonly number[]): RenderBar[] {
  return closes.map((close, index) => barAt(index, close));
}
