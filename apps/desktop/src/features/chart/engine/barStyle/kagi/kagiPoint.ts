import type { UTCTimestamp } from 'lightweight-charts';

/**
 * One Kagi bar: where the line starts and where it ends, which the series draws as the stroke at the bar's
 * slot. The styles the stroke is drawn in follow from the whole line, so a point carries its prices alone. A
 * point without a close is whitespace, which the chart skips.
 */
export interface KagiPoint {
  readonly time: UTCTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}
