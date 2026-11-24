import type { UTCTimestamp } from 'lightweight-charts';

/**
 * One Point & figure column: the box level it opened at and the box level it closed at, which the series draws as
 * a stack of marks at the bar's slot. High and low are the column's two ends, so the price scale fits the whole
 * stack, and a point without a close is whitespace, which the chart skips.
 */
export interface PointFigurePoint {
  readonly time: UTCTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}
