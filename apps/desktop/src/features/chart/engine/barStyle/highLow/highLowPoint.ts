import type { UTCTimestamp } from 'lightweight-charts';

/**
 * One high-low bar: its range, which the series draws as a box from the low to the high and labels at both
 * prices. A point without a high is whitespace, which the chart skips.
 */
export interface HighLowPoint {
  readonly time: UTCTimestamp;
  readonly high: number;
  readonly low: number;
}
