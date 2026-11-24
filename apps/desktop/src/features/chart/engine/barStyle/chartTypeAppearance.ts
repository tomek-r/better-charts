import {
  sameRenkoParameters,
  type BarStyleAppearance,
  type LineBreakAppearance,
  type RenkoAppearance,
} from './barStyleAppearance';

/** The bar styles whose bars the backend draws from the chart's candles. */
export const CHART_TYPE_STYLES = ['renko', 'lineBreak'] as const;

export type ChartTypeStyle = (typeof CHART_TYPE_STYLES)[number];

/** The appearance of a chart type's bars, as the settings ask for them. */
export type ChartTypeAppearance = RenkoAppearance | LineBreakAppearance;

/** Whether a bar style draws its own bars, which the chart asks for instead of drawing the candles. */
export function isChartTypeStyle(style: BarStyleAppearance['style']): style is ChartTypeStyle {
  return CHART_TYPE_STYLES.some((chartType) => chartType === style);
}

/** Whether an appearance is a chart type's, whose bars the chart asks for instead of drawing the candles. */
export function isChartTypeAppearance(appearance: BarStyleAppearance): appearance is ChartTypeAppearance {
  return appearance.style === 'renko' || appearance.style === 'lineBreak';
}

/** The chart type `appearance` draws, or null for a style that draws the chart's own candles. */
export function chartTypeAppearanceOf(appearance: BarStyleAppearance): ChartTypeAppearance | null {
  return isChartTypeAppearance(appearance) ? appearance : null;
}

/** Whether two chart types ask the command for the same bars, so a colour change costs no redraw. */
export function sameChartTypeParameters(first: ChartTypeAppearance, second: ChartTypeAppearance): boolean {
  if (first.style === 'renko' && second.style === 'renko') {
    return sameRenkoParameters(first, second);
  }
  if (first.style === 'lineBreak' && second.style === 'lineBreak') {
    return first.lines === second.lines;
  }
  return false;
}

/** Whether a chart type's bars show a wick: Line Break never, and a Renko brick only when its setting asks. */
export function chartTypeDrawsWicks(appearance: ChartTypeAppearance): boolean {
  return appearance.style === 'renko' && appearance.wicks;
}
