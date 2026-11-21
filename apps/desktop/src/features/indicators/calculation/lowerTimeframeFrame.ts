import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorBar, IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import { NO_FRAME_BAR, projectFrameBars } from '../indicatorFrameBars';

/** Which lower-timeframe bar a chart bar takes its values from. */
export type LowerTimeframeSource =
  /** The last lower bar that opened inside the chart bar, the forming one included. */
  | 'last-in-chart-bar'
  /** The last lower bar inside it that has closed, so the forming lower bar is left out. */
  | 'last-closed-in-chart-bar';

/**
 * For every chart bar, the index of the lower bar it shows: the last one that opened inside it, or the last one
 * that closed when `source` asks for closes. `NO_FRAME_BAR` while no such bar lies inside it.
 */
export function shownLowerBars(
  lowerBars: readonly RenderBar[],
  chartBars: readonly RenderBar[],
  chartSeconds: number,
  source: LowerTimeframeSource,
): readonly number[] {
  // Only the newest lower bar can still be forming, so asking for closes leaves just that one out.
  const newestShown = lowerBars.length - (source === 'last-closed-in-chart-bar' ? 2 : 1);
  const shownOf: number[] = [];
  let next = 0;
  for (const chartBar of chartBars) {
    const chartEnd = chartBar.time + chartSeconds;
    while (next <= newestShown && lowerBars[next].time < chartBar.time) {
      next += 1;
    }
    let shown = NO_FRAME_BAR;
    while (next <= newestShown && lowerBars[next].time < chartEnd) {
      shown = next;
      next += 1;
    }
    shownOf.push(shown);
  }
  return shownOf;
}

/** The plugin's lower-timeframe frame written onto the chart's bars: each carries the values of the bar it shows. */
export function projectLowerTimeframeFrame(
  frame: IndicatorFrame,
  chartBars: readonly RenderBar[],
  shownOf: readonly number[],
): readonly IndicatorBar[] {
  return projectFrameBars(frame, chartBars, (index) => shownOf[index]);
}
