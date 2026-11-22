import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { BarSeriesController } from '../bars/barSeriesController';
import { ChartIndicators } from '../indicators/chartIndicators';
import { IndicatorSelection } from '../indicators/indicatorSelection';
import type { ChartToolDefinition, ChartToolHost } from '../tools/toolContract';
import type { ChartControllerOptions } from './chartControllerOptions';

/** The chart handles the indicator wiring reads through the controller, none of which exists before it. */
export interface ChartIndicatorSeams {
  /** Drops the drawing selection: the chart selects one object at a time, so an indicator takes it over. */
  readonly clearDrawingSelection: () => void;
  /** Whether a drawing is the chart's selection: a click that picked one keeps it, as drawings win. */
  readonly drawingSelected: () => boolean;
  /** Whether the pointer rests on a plotted line the user can click, which the pane cursor follows. */
  readonly plotHoverChanged: (overPlot: boolean) => void;
}

/** What the tool host is given: the controller options without the chart's own wiring. */
export type ChartToolHostOptions = Pick<ChartToolHost, 'currentMarket' | 'marketDataPort' | 'notifyError'>;

/** The chart's indicators as the controller holds them, and the options the tool host is built from. */
export interface ChartIndicatorWiring {
  /** The indicator the user has selected, which the app and the drawing tools' selection share. */
  readonly selection: IndicatorSelection;
  /** The layer, the runtime and the legend, owned and torn down as one unit. */
  readonly indicators: ChartIndicators;
  /** Every tool the app offers this chart. */
  readonly toolDefinitions: readonly ChartToolDefinition[];
  /** The tool active at start and made active again after a placement. */
  readonly defaultToolId: string;
  /** The controller options a tool host may see. */
  readonly toolHost: ChartToolHostOptions;
}

/**
 * Builds the chart's indicators from the controller's options: the selection the app reads and the unit that
 * owns the layer, the runtime and the legend. The one destructure here keeps the chart's own wiring out of the
 * tool host, so a tool never receives the indicator definitions or the series sources.
 */
export function createChartIndicators(
  chart: IChartApi,
  host: HTMLElement,
  data: BarSeriesController,
  priceSeries: ISeriesApi<'Candlestick'>,
  options: ChartControllerOptions,
  seams: ChartIndicatorSeams,
): ChartIndicatorWiring {
  const {
    toolDefinitions,
    defaultToolId,
    indicatorDefinitions,
    indicatorLegendWords,
    indicatorSeriesSource,
    indicatorTickSource,
    ...toolHost
  } = options;
  const selection = new IndicatorSelection(seams.clearDrawingSelection);
  const indicators = new ChartIndicators(chart, host, {
    definitions: indicatorDefinitions,
    legendWords: indicatorLegendWords,
    bars: () => data.bars,
    timeframe: () => data.timeframe,
    digits: () => data.pricePrecision,
    priceSeries,
    seriesSource: indicatorSeriesSource,
    tickSource: indicatorTickSource,
    selection,
    drawingSelected: seams.drawingSelected,
    plotHoverChanged: seams.plotHoverChanged,
  });
  return { selection, indicators, toolDefinitions, defaultToolId, toolHost };
}
