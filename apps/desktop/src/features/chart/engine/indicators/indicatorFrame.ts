/**
 * The result format every indicator producer hands to the display layer.
 *
 * The split is absolute: producers never touch the chart, and the display layer never
 * computes a number. A producer turns bars into a frame; the display layer draws that
 * frame. Own panes are added to this format later.
 */

/** How a plot's line joins its points. */
export type IndicatorPlotStyle = 'line' | 'stepline';

/** How a plot's or a level's line is stroked; a missing style is solid. */
export type IndicatorLineStyle = 'solid' | 'dashed' | 'dotted';

/** One line of an indicator, described once for every bar. */
export interface IndicatorPlot {
  readonly title: string;
  readonly style: IndicatorPlotStyle;
  readonly color: string;
  readonly lineWidth: number;
  readonly lineStyle?: IndicatorLineStyle;
  /** False draws no line for this plot, while the legend still reports its value. */
  readonly visible?: boolean;
}

/** A horizontal line at a fixed price, the way Pine Script's `hline` draws one. */
export interface IndicatorLevel {
  readonly title: string;
  readonly price: number;
  readonly color: string;
  readonly lineWidth: number;
  readonly lineStyle?: IndicatorLineStyle;
  readonly visible?: boolean;
}

/** One end of a fill: an index into the frame's `plots` or into its `levels`. */
export type IndicatorFillEdge =
  { readonly kind: 'plot'; readonly index: number } | { readonly kind: 'level'; readonly index: number };

/** The band painted between two edges, under the lines. */
export interface IndicatorFill {
  readonly from: IndicatorFillEdge;
  readonly to: IndicatorFillEdge;
  readonly color: string;
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
 *
 * Levels and fills describe the whole frame rather than one bar, so the display layer
 * reads them when the frame is shown and keeps them until the indicator is shown again.
 */
export interface IndicatorFrame {
  readonly plots: readonly IndicatorPlot[];
  readonly bars: readonly IndicatorBar[];
  readonly levels?: readonly IndicatorLevel[];
  readonly fills?: readonly IndicatorFill[];
  /** Decimals the indicator's values are written with; omitted uses the chart's price precision. */
  readonly precision?: number;
}
