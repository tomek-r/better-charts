import {
  AreaSeries,
  HistogramSeries,
  LineSeries,
  LineType,
  type AutoscaleInfoProvider,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { withOpacityPercent } from '../../../../shared/theme/hexColor';
import type { IndicatorPlot, IndicatorPlotStyle } from './indicatorFrame';
import { toLibraryLineStyle } from './indicatorLevels';
import { toLineWidth } from './indicatorLineWidth';
import { AREA_BOTTOM_OPACITY_PERCENT, AREA_TOP_OPACITY_PERCENT } from './indicatorPoints';
import type { PlotDrawing, PlotLine, PlotMark } from './indicatorPlotInk';
import type { IndicatorMarkerShape } from './indicatorPlotMarkers';

/** One plot's series: a line, a shaded area, or columns drawn from zero. */
export type IndicatorPlotSeries = ISeriesApi<'Line'> | ISeriesApi<'Area'> | ISeriesApi<'Histogram'>;

/** How a drawn plot is drawn, as the dev hook reports it. */
export type IndicatorLineType =
  'simple' | 'step' | 'stepDiamonds' | 'area' | 'histogram' | 'stems' | 'crosses' | 'circles';

/** Columns grow out of this price and stems reach down to it, so both plots are anchored there. */
export const PLOT_BASE_PRICE = 0;

/** Whether a plot writes its last value on the price scale: a switched-off plot writes none. */
function writesPriceLabel(plot: IndicatorPlot, priceLabelsVisible: boolean): boolean {
  return priceLabelsVisible && plot.visible !== false;
}

/** The stroke settings every plotted line shares, area or plain. */
function strokeOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    lineWidth: toLineWidth(plot.lineWidth),
    lineStyle: toLibraryLineStyle(plot.lineStyle),
    lineVisible: plot.visible !== false,
    priceLineVisible: plot.priceLine === true,
    lastValueVisible: writesPriceLabel(plot, priceLabelsVisible),
    crosshairMarkerVisible: false,
  };
}

/** The options a line plot's series is created with. */
function lineOptionsOf(plot: IndicatorPlot, lineType: LineType, priceLabelsVisible: boolean) {
  return { color: plot.color, lineType, ...strokeOptionsOf(plot, priceLabelsVisible) };
}

/** The options a marker-only style's line plot is created with: its markers are all it shows. */
function markersOnlyOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    ...lineOptionsOf(plot, LineType.Simple, priceLabelsVisible),
    lineVisible: false,
    visible: plot.visible !== false,
  };
}

/** The options an area plot's series is created with: its colour shades the region under the line. */
function areaOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    lineColor: plot.color,
    topColor: withOpacityPercent(plot.color, AREA_TOP_OPACITY_PERCENT),
    bottomColor: withOpacityPercent(plot.color, AREA_BOTTOM_OPACITY_PERCENT),
    ...strokeOptionsOf(plot, priceLabelsVisible),
  };
}

/** The options a histogram plot's series is created with: one colour for every column unless a bar carries one. */
function histogramOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    color: plot.color,
    base: PLOT_BASE_PRICE,
    priceLineVisible: plot.priceLine === true,
    lastValueVisible: writesPriceLabel(plot, priceLabelsVisible),
    visible: plot.visible !== false,
  };
}

/** Keeps the base price on the scale even when every value sits above it. */
const includingBasePrice: AutoscaleInfoProvider = (baseImplementation) => {
  const autoscale = baseImplementation();
  if (autoscale === null || autoscale.priceRange === null) {
    return autoscale;
  }
  return {
    ...autoscale,
    priceRange: {
      minValue: Math.min(autoscale.priceRange.minValue, PLOT_BASE_PRICE),
      maxValue: Math.max(autoscale.priceRange.maxValue, PLOT_BASE_PRICE),
    },
  };
};

/** Everything that differs between plot styles; a style on an existing series type needs only its entry here. */
export interface PlotStyleRule {
  /** How the dev hook reports the style. */
  readonly lineType: IndicatorLineType;
  /** Whether the style strokes a line through its points, as a plain, stepped or area plot does. */
  readonly drawsLine: boolean;
  /** The marker the style draws, when it draws one. */
  readonly markerShape: IndicatorMarkerShape | null;
  /** Whether a switched-off plot has no line to hide instead, so its whole series goes with it. */
  readonly hidesWholeSeries: boolean;
  /** Whether the style draws its values from price zero, as columns and stems do. */
  readonly drawsFromZero: boolean;
  /** Adds the style's series at `paneIndex`, without the price format, floor and markers every style shares. */
  readonly addSeries: (
    chart: IChartApi,
    plot: IndicatorPlot,
    paneIndex: number | undefined,
    priceLabelsVisible: boolean,
  ) => IndicatorPlotSeries;
}

function lineRule(
  lineType: IndicatorLineType,
  libraryLineType: LineType,
  markerShape: IndicatorMarkerShape | null,
): PlotStyleRule {
  return {
    lineType,
    drawsLine: true,
    markerShape,
    hidesWholeSeries: false,
    drawsFromZero: false,
    addSeries: (chart, plot, paneIndex, priceLabelsVisible) =>
      chart.addSeries(LineSeries, lineOptionsOf(plot, libraryLineType, priceLabelsVisible), paneIndex),
  };
}

function markersOnlyRule(lineType: IndicatorLineType, markerShape: IndicatorMarkerShape): PlotStyleRule {
  return {
    lineType,
    drawsLine: false,
    markerShape,
    hidesWholeSeries: true,
    drawsFromZero: false,
    addSeries: (chart, plot, paneIndex, priceLabelsVisible) =>
      chart.addSeries(LineSeries, markersOnlyOptionsOf(plot, priceLabelsVisible), paneIndex),
  };
}

/** One entry per plot style. */
export const PLOT_STYLE_RULES: Record<IndicatorPlotStyle, PlotStyleRule> = {
  line: lineRule('simple', LineType.Simple, null),
  stepline: lineRule('step', LineType.WithSteps, null),
  steplineDiamonds: lineRule('stepDiamonds', LineType.WithSteps, 'diamond'),
  area: {
    lineType: 'area',
    drawsLine: true,
    markerShape: null,
    hidesWholeSeries: false,
    drawsFromZero: false,
    addSeries: (chart, plot, paneIndex, priceLabelsVisible) =>
      chart.addSeries(AreaSeries, areaOptionsOf(plot, priceLabelsVisible), paneIndex),
  },
  histogram: {
    lineType: 'histogram',
    drawsLine: false,
    markerShape: null,
    hidesWholeSeries: true,
    drawsFromZero: true,
    addSeries: (chart, plot, paneIndex, priceLabelsVisible) =>
      chart.addSeries(HistogramSeries, histogramOptionsOf(plot, priceLabelsVisible), paneIndex),
  },
  stems: {
    lineType: 'stems',
    drawsLine: false,
    markerShape: 'stem',
    hidesWholeSeries: true,
    drawsFromZero: true,
    addSeries: (chart, plot, paneIndex, priceLabelsVisible) =>
      chart.addSeries(
        LineSeries,
        { ...markersOnlyOptionsOf(plot, priceLabelsVisible), autoscaleInfoProvider: includingBasePrice },
        paneIndex,
      ),
  },
  crosses: markersOnlyRule('crosses', 'cross'),
  circles: markersOnlyRule('circles', 'circle'),
};

/**
 * How a plot's style draws what it plots, as the hit test reads it: the line it strokes, and the mark it
 * puts on each point — a column up from `baseY`, where the pane draws the price the style grows from.
 */
export function plotDrawingOf(rule: PlotStyleRule, baseY: number | null): PlotDrawing {
  return { line: lineOf(rule), mark: markOf(rule, baseY) };
}

/** The line a style strokes, if it strokes one. */
function lineOf(rule: PlotStyleRule): PlotLine {
  if (!rule.drawsLine) {
    return 'none';
  }
  return rule.lineType === 'step' || rule.lineType === 'stepDiamonds' ? 'stepped' : 'straight';
}

/** The ink a style puts at each point: a column from its base, a marker, or nothing. */
function markOf(rule: PlotStyleRule, baseY: number | null): PlotMark {
  if (rule.drawsFromZero) {
    return baseY === null ? { kind: 'none' } : { kind: 'column', baseY };
  }
  return rule.markerShape === null ? { kind: 'none' } : { kind: 'marker' };
}
