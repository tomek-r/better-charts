import type { CandlePointColors, CandleSeriesColors } from '../../bars/candleAppearance';
import type { CandleGlyphColors } from '../candleGlyph';

/** A candle's prices and the colours its point names for its own body, border and wick. */
export interface ColoredCandlePrices extends CandlePointColors {
  readonly open: number;
  readonly close: number;
}

/**
 * The colours one candle is drawn in. A part the point names a colour for keeps it; every other part takes
 * the series' candle colour for the bar's side, so a hidden body still leaves a visible border and wick.
 */
export function volumeCandleColors(options: CandleSeriesColors, point: ColoredCandlePrices): CandleGlyphColors {
  const rose = point.close >= point.open;
  return {
    body: point.color ?? (rose ? options.upColor : options.downColor),
    border: point.borderColor ?? (rose ? options.borderUpColor : options.borderDownColor),
    wick: point.wickColor ?? (rose ? options.wickUpColor : options.wickDownColor),
  };
}
