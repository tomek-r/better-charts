import type { VolumeCandlePoint } from './volumeCandlePoint';
import type { VolumeCandlesOptions } from './volumeCandlesOptions';

/** The colours one candle is drawn in: its body, the outline of that body and its wick. */
export interface VolumeCandleColors {
  readonly body: string;
  readonly border: string;
  readonly wick: string;
}

/**
 * The colours one candle is drawn in. A part the point names a colour for keeps it; every other part takes
 * the series' candle colour for the bar's side, so a hidden body still leaves a visible border and wick.
 */
export function volumeCandleColors(options: VolumeCandlesOptions, point: VolumeCandlePoint): VolumeCandleColors {
  const rose = point.close >= point.open;
  return {
    body: point.color ?? (rose ? options.upColor : options.downColor),
    border: point.borderColor ?? (rose ? options.borderUpColor : options.borderDownColor),
    wick: point.wickColor ?? (rose ? options.wickUpColor : options.wickDownColor),
  };
}
