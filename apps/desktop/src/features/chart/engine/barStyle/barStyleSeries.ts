import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type SeriesDefinition,
  type SeriesPartialOptionsMap,
  type SeriesType,
} from 'lightweight-charts';
import { candleSeriesColors } from '../bars/candleAppearance';
import type { RenderBar } from '../bars/renderBar';
import {
  DEFAULT_BAR_STYLE_APPEARANCE,
  sameBarStyleAppearance,
  type BarStyleAppearance,
  type DrawnBarStyleAppearance,
} from './barStyleAppearance';
import { BaselineLevel, priceBaseValue } from './baselineLevel';
import { barStylePoint, barStylePoints } from './barStylePoints';
import { HeikinAshiChain } from './heikinAshi';

/** What a bar style series is created and updated with, as the library types it for a series type. */
type BarStyleSeriesOptions = SeriesPartialOptionsMap[SeriesType];

/** The price scale the bars are drawn on, which is the anchor series' own. */
const PRICE_SCALE_ID = 'right';

/** The library series that draws each bar style a series of its own draws; candles are the anchor's. */
const SERIES_DEFINITION_BY_STYLE: Readonly<Record<DrawnBarStyleAppearance['style'], SeriesDefinition<SeriesType>>> = {
  bars: BarSeries,
  baseline: BaselineSeries,
  hollowCandles: CandlestickSeries,
  heikinAshi: CandlestickSeries,
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
 * The options one appearance draws with. The points carry the colours an option cannot express, so
 * the series options hold only what a whole series shares: the anchor's price scale, no price line
 * and no last value, and no say in the price fit — the anchor's real OHLC alone decides the range.
 */
function seriesOptionsOf(appearance: DrawnBarStyleAppearance, digits: number): BarStyleSeriesOptions {
  const common = {
    priceScaleId: PRICE_SCALE_ID,
    priceLineVisible: false,
    lastValueVisible: false,
    autoscaleInfoProvider: () => null,
    priceFormat: priceFormatOf(digits),
  };
  switch (appearance.style) {
    case 'hollowCandles':
      // The border outlines the hole of a hollow candle, so both parts stay switched on.
      return { ...common, borderVisible: true, wickVisible: true };
    case 'heikinAshi':
      // The Heikin Ashi bars take the body, border and wick colours the candles are saved with.
      return { ...common, ...candleSeriesColors(appearance.candles) };
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
    case 'baseline':
      // Both halves of each fill are the one colour, so no gradient is mixed into the saved fills.
      return {
        ...common,
        topLineColor: appearance.topLine,
        topFillColor1: appearance.topFill,
        topFillColor2: appearance.topFill,
        bottomLineColor: appearance.bottomLine,
        bottomFillColor1: appearance.bottomFill,
        bottomFillColor2: appearance.bottomFill,
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

/**
 * The second series that draws the chart's bars while the bar style is not candles. The anchor series
 * stays the one every primitive, the price format and the price fit read, so this series draws the bars
 * and nothing else, and it is added last so it paints above them.
 */
export class BarStyleSeries {
  private appearance: BarStyleAppearance = DEFAULT_BAR_STYLE_APPEARANCE;
  private series: ISeriesApi<SeriesType> | null = null;
  private options: BarStyleSeriesOptions | null = null;
  private priceDigits = 2;
  /** The Heikin Ashi bars written so far, which every bar of that style chains on. */
  private readonly heikinAshiChain = new HeikinAshiChain();
  /** The baseline's level, carried by the baseline series as its primitive. */
  private baselineLevel: BaselineLevel | null = null;

  constructor(private readonly chart: IChartApi) {}

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
    // Heikin Ashi rewrites every bar onto the ones before it; every other style plots the bars it got.
    const plotted = appearance.style === 'heikinAshi' ? this.heikinAshiChain.rebuild(bars) : bars;
    this.baselineLevel?.setLastBar(plotted[plotted.length - 1]);
    series.setData(barStylePoints(appearance, plotted));
  }

  /** Writes one bar; `previous` is the bar before it, which the colour rules read. */
  updateBar(bar: RenderBar, previous: RenderBar | undefined): void {
    const series = this.series;
    const appearance = this.drawnAppearance();
    if (series === null || appearance === null) {
      return;
    }
    // A Heikin Ashi bar chains on the Heikin Ashi bar before it; every other style writes the bar given.
    const plotted = appearance.style === 'heikinAshi' ? this.heikinAshiChain.advance(bar) : { bar, previous };
    this.baselineLevel?.setLastBar(plotted.bar);
    series.update(barStylePoint(appearance, plotted.bar, plotted.previous));
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
      options: this.shownOptions(),
      points: this.readPoints(),
    };
  }

  destroy(): void {
    this.removeSeries();
  }

  /** The appearance as the drawing code takes it, or none for candles, which the anchor series draws. */
  private drawnAppearance(): DrawnBarStyleAppearance | null {
    const appearance = this.appearance;
    return appearance.style === 'candles' ? null : appearance;
  }

  /** Draws the appearance's series, and the level a baseline fills around. */
  private drawSeries(): void {
    const appearance = this.drawnAppearance();
    if (appearance === null) {
      this.removeSeries();
      return;
    }
    const options = seriesOptionsOf(appearance, this.priceDigits);
    const series = this.seriesFor(appearance, options);
    this.options = options;
    this.syncBaselineLevel(series, appearance);
  }

  /** The series a style draws with: the one in place when its type fits, a replaced one otherwise. */
  private seriesFor(appearance: DrawnBarStyleAppearance, options: BarStyleSeriesOptions): ISeriesApi<SeriesType> {
    const definition = SERIES_DEFINITION_BY_STYLE[appearance.style];
    const series = this.series;
    if (series !== null && series.seriesType() === definition.type) {
      series.applyOptions(options);
      return series;
    }
    this.removeSeries();
    const added = this.chart.addSeries(definition, options);
    this.series = added;
    return added;
  }

  /**
   * Gives the baseline series its level, which rides on that series because only its paints know when
   * the price scale's range for the paint is set.
   */
  private syncBaselineLevel(series: ISeriesApi<SeriesType>, appearance: DrawnBarStyleAppearance): void {
    if (appearance.style !== 'baseline') {
      return;
    }
    const level = this.baselineLevel;
    if (level !== null) {
      level.setLevel(appearance);
      return;
    }
    const added = new BaselineLevel(appearance);
    this.baselineLevel = added;
    series.attachPrimitive(added);
  }

  /** Removes the series, detaching the level first because the level reads the series it rides on. */
  private removeSeries(): void {
    const series = this.series;
    const level = this.baselineLevel;
    if (series === null) {
      return;
    }
    if (level !== null) {
      series.detachPrimitive(level);
    }
    this.baselineLevel = null;
    this.chart.removeSeries(series);
    this.series = null;
    this.options = null;
  }

  /** The options the series was drawn with, plus the base price the level applied since. */
  private shownOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = this.options === null ? {} : { ...this.options };
    const basePrice = this.baselineLevel === null ? null : this.baselineLevel.basePrice();
    if (basePrice !== null) {
      options.baseValue = priceBaseValue(basePrice);
    }
    return options;
  }

  /** The points as plain copies, never the library's own objects; their time is the bar's UTC seconds. */
  private readPoints(): readonly Record<string, unknown>[] {
    const series = this.series;
    if (series === null) {
      return [];
    }
    return series.data().map((point) => ({ ...point }));
  }
}
