/**
 * The result format every indicator producer hands to the display layer.
 *
 * The split is absolute: producers never touch the chart, and the display layer never
 * computes a number. A producer turns bars into a frame; the display layer draws that
 * frame. Levels, fills and own panes are added to this format later.
 */

/** How a plot's line joins its points. */
export type IndicatorPlotStyle = 'line' | 'stepline';

/** One line of an indicator, described once for every bar. */
export interface IndicatorPlot {
  readonly title: string;
  readonly style: IndicatorPlotStyle;
  readonly color: string;
  readonly lineWidth: number;
}

/**
 * One bar of an indicator: `values[i]` and `colors[i]` both belong to `plots[i]`.
 *
 * A `null` value means "no value" and breaks the line. `confirmed` is false while the
 * bar is still forming.
 */
export interface IndicatorBar {
  readonly timeMs: number;
  readonly confirmed: boolean;
  readonly values: readonly (number | null)[];
  readonly colors?: readonly (string | null)[];
}

/**
 * A whole frame of an indicator.
 *
 * A load carries every bar, oldest first. A live update carries the closed bar, if any,
 * then the forming one, and each bar replaces the bar with the same `timeMs`.
 */
export interface IndicatorFrame {
  readonly plots: readonly IndicatorPlot[];
  readonly bars: readonly IndicatorBar[];
}
