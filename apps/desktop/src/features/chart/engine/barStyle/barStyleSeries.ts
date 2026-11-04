import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineType,
  type DataItem,
  type IChartApi,
  type ISeriesApi,
  type SeriesDefinition,
  type SeriesPartialOptionsMap,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import {
  DEFAULT_BAR_STYLE_APPEARANCE,
  sameBarStyleAppearance,
  type BarStyleAppearance,
  type DrawnBarStyleAppearance,
} from './barStyleAppearance';
import { barStylePoint, barStylePoints } from './barStylePoints';

/** What a bar style series is created and updated with, as the library types it for a series type. */
type BarStyleSeriesOptions = SeriesPartialOptionsMap[SeriesType];

/** The library series that draws each bar style a series of its own draws; candles are the anchor's. */
const SERIES_DEFINITION_BY_STYLE: Readonly<Record<DrawnBarStyleAppearance['style'], SeriesDefinition<SeriesType>>> = {
  bars: BarSeries,
  hollowCandles: CandlestickSeries,
  line: LineSeries,
  lineWithMarkers: LineSeries,
  stepLine: LineSeries,
  area: AreaSeries,
  columns: HistogramSeries,
};

/** The anchor series' price format, so both series label a price the same way. */
function priceFormatOf(digits: number) {
  return { type: 'price' as const, precision: digits, minMove: 10 ** -digits };
}

/**
 * What every bar style series is created with: the anchor's price scale, no price line and no last
 * value, and no say in the price fit — the anchor's real OHLC alone decides the visible range.
 */
function commonOptions(digits: number) {
  return {
    priceScaleId: 'right',
    priceLineVisible: false,
    lastValueVisible: false,
    autoscaleInfoProvider: () => null,
    priceFormat: priceFormatOf(digits),
  };
}

/**
 * The options one appearance draws with. The points carry the colours an option cannot express, so
 * the series options hold only what a whole series shares.
 */
function seriesOptionsOf(appearance: DrawnBarStyleAppearance, digits: number): BarStyleSeriesOptions {
  const common = commonOptions(digits);
  switch (appearance.style) {
    case 'hollowCandles':
      // The border outlines the hole of a hollow candle, so both parts stay switched on.
      return { ...common, borderVisible: true, wickVisible: true };
    case 'bars':
      return {
        ...common,
        upColor: appearance.colors.up,
        downColor: appearance.colors.down,
        thinBars: appearance.thinBars,
        openVisible: !appearance.hlcBars,
      };
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
      return {
        ...common,
        color: appearance.color,
        lineWidth: appearance.lineWidth,
        lineType: appearance.style === 'stepLine' ? LineType.WithSteps : LineType.Simple,
        pointMarkersVisible: appearance.style === 'lineWithMarkers',
        crosshairMarkerVisible: false,
      };
    case 'area':
      return {
        ...common,
        lineColor: appearance.lineColor,
        topColor: appearance.fillTop,
        bottomColor: appearance.fillBottom,
        lineWidth: appearance.lineWidth,
        crosshairMarkerVisible: false,
      };
    case 'columns':
      return common;
  }
}

/** The bar style series as the test hook shows it: its style, series type, options and points. */
export interface BarStyleSeriesState {
  readonly style: BarStyleAppearance['style'];
  readonly seriesType: string | null;
  readonly options: Record<string, unknown>;
  readonly points: readonly Record<string, unknown>[];
}

/** One point as the hook shows it: a plain copy, never the library's own object. */
function pointState(point: DataItem<Time>): Record<string, unknown> {
  return { ...point };
}

/**
 * The second series that draws the chart's bars while the bar style is not candles. The anchor series
 * stays the one every primitive, the price format and the price fit read, so this series draws the
 * bars and nothing else: it shares the anchor's scale and hides its own price line and last value.
 *
 * It is built after the surface's three series, so its series is added last and paints above them.
 */
export class BarStyleSeries {
  private appearance: BarStyleAppearance = DEFAULT_BAR_STYLE_APPEARANCE;
  private series: ISeriesApi<SeriesType> | null = null;
  private options: BarStyleSeriesOptions | null = null;
  private priceDigits = 2;

  constructor(private readonly chart: IChartApi) {}

  /** Whether the anchor series paints the bars, because this style has no series of its own. */
  drawsWithAnchor(): boolean {
    return this.series === null;
  }

  /**
   * Draws `appearance` over `bars`. A series of another type cannot be repainted into the new one, so a
   * change of family replaces it; every other change is an option update on the series in place.
   */
  apply(appearance: BarStyleAppearance, bars: readonly RenderBar[]): void {
    if (sameBarStyleAppearance(appearance, this.appearance)) {
      return;
    }
    this.appearance = appearance;
    this.drawSeries();
    this.replaceBars(bars);
  }

  /** Rewrites every point, which is what a replaced window of bars needs. */
  replaceBars(bars: readonly RenderBar[]): void {
    const series = this.series;
    const appearance = this.drawnAppearance();
    if (series === null || appearance === null) {
      return;
    }
    series.setData(barStylePoints(appearance, bars));
  }

  /** Writes one bar; `previous` is the bar before it, which the colour rules read. */
  updateBar(bar: RenderBar, previous: RenderBar | undefined): void {
    const series = this.series;
    const appearance = this.drawnAppearance();
    if (series === null || appearance === null) {
      return;
    }
    series.update(barStylePoint(appearance, bar, previous));
  }

  /** Applies the anchor series' price precision, so both series label a price the same way. */
  setPrecision(digits: number): void {
    if (digits === this.priceDigits) {
      return;
    }
    this.priceDigits = digits;
    this.series?.applyOptions({ priceFormat: priceFormatOf(digits) });
  }

  /** The series as the test hook shows it, every value a plain copy or a library scalar. */
  state(): BarStyleSeriesState {
    return {
      style: this.appearance.style,
      seriesType: this.series?.seriesType() ?? null,
      options: this.options === null ? {} : { ...this.options },
      points: this.readPoints(),
    };
  }

  destroy(): void {
    this.removeSeries();
  }

  /**
   * The appearance as the drawing code takes it, or none for candles, which the anchor series draws
   * and so leave this series with no point to write.
   */
  private drawnAppearance(): DrawnBarStyleAppearance | null {
    const appearance = this.appearance;
    return appearance.style === 'candles' ? null : appearance;
  }

  private drawSeries(): void {
    const appearance = this.drawnAppearance();
    if (appearance === null) {
      this.removeSeries();
      return;
    }
    const definition = SERIES_DEFINITION_BY_STYLE[appearance.style];
    const options = seriesOptionsOf(appearance, this.priceDigits);
    if (this.series !== null && this.series.seriesType() === definition.type) {
      this.series.applyOptions(options);
    } else {
      this.removeSeries();
      this.series = this.chart.addSeries(definition, options);
    }
    this.options = options;
  }

  private removeSeries(): void {
    if (this.series === null) {
      return;
    }
    this.chart.removeSeries(this.series);
    this.series = null;
    this.options = null;
  }

  /** The points as plain copies; their time is the bar's UTC seconds, as on the anchor series. */
  private readPoints(): readonly Record<string, unknown>[] {
    const series = this.series;
    if (series === null) {
      return [];
    }
    return series.data().map(pointState);
  }
}
