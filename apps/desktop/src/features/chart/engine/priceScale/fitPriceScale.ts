import type { ISeriesApi } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { setPriceScaleRange } from './priceScaleRange';

/** The viewport whose candles the price scale is fitted to: its right edge, zoom and plot width. */
export interface PriceFitViewport {
  /** Logical index of the pane's right edge. */
  to: number;
  barSpacing: number;
  /** Width of the plot area in CSS px. */
  paneWidth: number;
}

/**
 * Fits the price scale to the candles a viewport ending at `to` shows.
 *
 * Auto scale is off by default, and the library keeps the current range across a
 * data replacement — the next symbol's prices would draw off the pane — so a new
 * series is fitted here, in the same task that decided the viewport, and no frame
 * is drawn with the old range on new candles. The range is the high/low extent of
 * the candles the pane shows, which is what the library's own fit reports for
 * them. It then holds until the next replacement, which is the point: a tick no
 * longer rescales the pane.
 */
export function fitPriceScale(
  candles: ISeriesApi<'Candlestick'>,
  bars: readonly RenderBar[],
  { to, barSpacing, paneWidth }: PriceFitViewport,
): void {
  if (candles.priceScale().options().autoScale || !bars.length) {
    return;
  }
  const paneBars = Math.max(1, Math.ceil(paneWidth / barSpacing));
  const first = Math.max(0, Math.floor(to - paneBars));
  const last = Math.min(bars.length - 1, Math.ceil(to));
  let low = Infinity;
  let high = -Infinity;
  for (let index = first; index <= last; index += 1) {
    low = Math.min(low, bars[index].low);
    high = Math.max(high, bars[index].high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return;
  }
  if (high <= low) {
    // A window of identical candles has no extent to fit; pad by the symbol's
    // smallest price step so the range still contains them.
    const format = candles.options().priceFormat;
    const padding = format.type === 'price' ? format.minMove : 0.01;
    low -= padding;
    high += padding;
  }
  setPriceScaleRange(candles, { from: low, to: high });
}
