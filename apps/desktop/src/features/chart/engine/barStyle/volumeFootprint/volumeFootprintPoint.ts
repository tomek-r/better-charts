import type { UTCTimestamp } from 'lightweight-charts';
import type { BarFootprint } from './footprintData';

/**
 * One footprint bar: the bar's own prices, the colours the chart's candle settings give it and, once the
 * host read every tick of the bar, the footprint its columns are drawn from. A point without a close is
 * whitespace, which the chart skips.
 */
export interface VolumeFootprintPoint {
  readonly time: UTCTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly color?: string;
  readonly borderColor?: string;
  readonly wickColor?: string;
  /** The bar's rows, POC and value area; absent while the host holds no whole ticks for the bar. */
  readonly footprint?: BarFootprint;
}
