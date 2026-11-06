import type { UTCTimestamp } from 'lightweight-charts';
import { withOpacityPercent } from '../../../../shared/theme/hexColor';
import type { IndicatorBar, IndicatorPlot } from './indicatorFrame';
import {
  AREA_BOTTOM_OPACITY_PERCENT,
  AREA_TOP_OPACITY_PERCENT,
  type IndicatorAreaPoint,
  type IndicatorPlotPoint,
} from './indicatorPlotSeries';

/** The chart's bar time of an indicator bar: the UTC seconds every series point is keyed by. */
export function timeOf(bar: IndicatorBar): UTCTimestamp {
  return Math.floor(bar.timeMs / 1000) as UTCTimestamp;
}

/** An area point in its bar's colour: the line takes it and the band shades it from top to bottom. */
function areaPointOf(time: UTCTimestamp, value: number, color: string): IndicatorAreaPoint {
  return {
    time,
    value,
    lineColor: color,
    topColor: withOpacityPercent(color, AREA_TOP_OPACITY_PERCENT),
    bottomColor: withOpacityPercent(color, AREA_BOTTOM_OPACITY_PERCENT),
  };
}

/**
 * One bar's point for one plot: its value in the colour the bar carries, a time-only whitespace point that
 * breaks the plot, or no point at all when the plot joins across a missing value.
 */
export function pointOf(bar: IndicatorBar, plot: IndicatorPlot, plotIndex: number): IndicatorPlotPoint | null {
  const time = timeOf(bar);
  const value = bar.values[plotIndex];
  if (value === null || !Number.isFinite(value)) {
    return plot.gaps === 'connect' ? null : { time };
  }
  const color = bar.colors?.[plotIndex];
  if (typeof color !== 'string') {
    return { time, value };
  }
  return plot.style === 'area' ? areaPointOf(time, value, color) : { time, value, color };
}

/** One plot's whole data: a bar without a value is left out where the plot joins across it. */
export function pointsOf(bars: readonly IndicatorBar[], plot: IndicatorPlot, plotIndex: number): IndicatorPlotPoint[] {
  const points: IndicatorPlotPoint[] = [];
  for (const bar of bars) {
    const point = pointOf(bar, plot, plotIndex);
    if (point !== null) {
      points.push(point);
    }
  }
  return points;
}

/** The time of a frame's last bar, which a live update may not go back behind; null for a frame without bars. */
export function lastTimeOf(bars: readonly IndicatorBar[]): number | null {
  const lastBar = bars[bars.length - 1];
  return lastBar === undefined ? null : timeOf(lastBar);
}
