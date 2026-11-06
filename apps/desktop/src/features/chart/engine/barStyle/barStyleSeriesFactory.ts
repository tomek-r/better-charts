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
import { PRICE_SCALE_ID } from '../priceScale/priceScaleId';
import {
  isCustomBarStyle,
  type DrawnBarStyleAppearance,
  type HighLowAppearance,
  type LibraryBarStyleAppearance,
  type VolumeCandlesAppearance,
} from './barStyleAppearance';
import { HIGH_LOW_DEFAULT_OPTIONS, type HighLowOptions } from './highLow/highLowOptions';
import { HighLowPaneView } from './highLow/highLowPaneView';
import { VOLUME_CANDLES_DEFAULT_OPTIONS, type VolumeCandlesOptions } from './volumeCandles/volumeCandlesOptions';
import { VolumeCandlesPaneView } from './volumeCandles/volumeCandlesPaneView';

/** What a bar style series is created and updated with, as the library types it for a series type. */
type BarStyleSeriesOptions = SeriesPartialOptionsMap[SeriesType];

/** The styles a library series type of its own draws. */
type LibraryBarStyle = LibraryBarStyleAppearance['style'];

/** The series one drawing step hands back: the series that draws the bars, and the options it holds. */
export interface DrawnBarStyleSeries {
  readonly series: ISeriesApi<SeriesType>;
  readonly options: Readonly<Record<string, unknown>>;
}

/** The library series that draws each bar style a library type paints; the custom styles have pane views. */
const SERIES_DEFINITION_BY_STYLE: Readonly<Record<LibraryBarStyle, SeriesDefinition<SeriesType>>> = {
  bars: BarSeries,
  baseline: BaselineSeries,
  columns: HistogramSeries,
  hollowCandles: CandlestickSeries,
  heikinAshi: CandlestickSeries,
  line: LineSeries,
  lineWithMarkers: LineSeries,
  stepLine: LineSeries,
  area: AreaSeries,
};

/** The anchor series' price format, so both series label a price the same way. */
function priceFormatOf(digits: number) {
  return { type: 'price' as const, precision: digits, minMove: 10 ** -digits };
}

/**
 * The options every bar style series shares. The points carry the colours an option cannot express, so
 * these hold only what a whole series shares: the anchor's price scale, no price line and no last value,
 * and no say in the price fit — the anchor's real OHLC alone decides the range.
 */
function barStyleCommonOptions(digits: number) {
  return {
    priceScaleId: PRICE_SCALE_ID,
    priceLineVisible: false,
    lastValueVisible: false,
    autoscaleInfoProvider: () => null,
    priceFormat: priceFormatOf(digits),
  };
}

/** The options a library series draws `appearance` with. */
function definitionOptionsOf(appearance: LibraryBarStyleAppearance, digits: number): BarStyleSeriesOptions {
  const common = barStyleCommonOptions(digits);
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

/** The options a volume candle series draws `appearance` with: the chart's candle colours, series-wide. */
function volumeCandlesOptionsOf(appearance: VolumeCandlesAppearance, digits: number): VolumeCandlesOptions {
  return {
    ...VOLUME_CANDLES_DEFAULT_OPTIONS,
    ...barStyleCommonOptions(digits),
    ...candleSeriesColors(appearance.candles),
    widthSensitivity: appearance.widthSensitivity,
  };
}

/** The options a high-low series draws `appearance` with, labelling prices at the anchor's precision. */
function highLowOptionsOf(appearance: HighLowAppearance, digits: number): HighLowOptions {
  return {
    ...HIGH_LOW_DEFAULT_OPTIONS,
    ...barStyleCommonOptions(digits),
    body: appearance.body,
    borders: appearance.borders,
    labels: appearance.labels,
    labelPrecision: digits,
  };
}

/**
 * Paints the appearance's series: repaints `series` in `options` when one is given, and adds the series
 * `addSeries` creates otherwise. The options are reported back as the test hook shows them.
 */
function paintBarStyleSeries(
  series: ISeriesApi<SeriesType> | null,
  options: BarStyleSeriesOptions,
  addSeries: () => ISeriesApi<SeriesType>,
): DrawnBarStyleSeries {
  if (series !== null) {
    series.applyOptions(options);
    return { series, options: { ...options } };
  }
  return { series: addSeries(), options: { ...options } };
}

/**
 * Whether a series drawing `drawnStyle` can repaint in `style`'s colours. A library type can, while a
 * custom series draws one style only: its pane view cannot be swapped for another one.
 */
export function canRepaintBarStyleSeries(
  drawnStyle: DrawnBarStyleAppearance['style'],
  style: DrawnBarStyleAppearance['style'],
): boolean {
  if (isCustomBarStyle(style) || isCustomBarStyle(drawnStyle)) {
    return drawnStyle === style;
  }
  return SERIES_DEFINITION_BY_STYLE[drawnStyle].type === SERIES_DEFINITION_BY_STYLE[style].type;
}

/** Draws the bars' series for `appearance`, repainting `series` when the style fits it and replacing it otherwise. */
export function drawBarStyleSeries(
  chart: IChartApi,
  series: ISeriesApi<SeriesType> | null,
  appearance: DrawnBarStyleAppearance,
  digits: number,
): DrawnBarStyleSeries {
  if (appearance.style === 'highLow') {
    const options = highLowOptionsOf(appearance, digits);
    return paintBarStyleSeries(series, options, () => chart.addCustomSeries(new HighLowPaneView(), options));
  }
  if (appearance.style === 'volumeCandles') {
    const options = volumeCandlesOptionsOf(appearance, digits);
    return paintBarStyleSeries(series, options, () => chart.addCustomSeries(new VolumeCandlesPaneView(), options));
  }
  const definition = SERIES_DEFINITION_BY_STYLE[appearance.style];
  const options = definitionOptionsOf(appearance, digits);
  return paintBarStyleSeries(series, options, () => chart.addSeries(definition, options));
}
