import type { UTCTimestamp } from 'lightweight-charts';

/**
 * One volume candle: the bar's own prices, the volume its body width follows and the colours the chart's
 * candle settings give it. A point without a close is whitespace, which the chart skips.
 */
export interface VolumeCandlePoint {
  readonly time: UTCTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly color?: string;
  readonly borderColor?: string;
  readonly wickColor?: string;
}
