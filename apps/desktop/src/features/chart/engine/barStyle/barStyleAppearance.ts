import type { ChartFootprintRequest } from '../../../../shared/bridge/types';
import { DEFAULT_CANDLE_APPEARANCE, sameCandleAppearance, type CandleAppearance } from '../bars/candleAppearance';
import type { BoxMethod } from './boxMethod';
import type { PointFigureSource } from './pointFigureSource';
import type { PriceSource } from './priceSource';
import type { FootprintDisplay, FootprintType, FootprintValues } from './volumeFootprint/footprintModes';

/** The widths a bar style's line is drawn with, which is the range the settings offer. */
export type BarStyleLineWidth = 1 | 2 | 3 | 4;

export function isBarStyleLineWidth(value: unknown): value is BarStyleLineWidth {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** The colour a bar style paints each direction with. */
export interface BarDirectionColors {
  readonly up: string;
  readonly down: string;
}

/** A colour a switch draws one part of a bar in, and whether that part is drawn at all. */
export interface ToggledColor {
  readonly visible: boolean;
  readonly color: string;
}

/** Plain candles, which the anchor series draws itself from the chart's body, border and wick settings. */
export interface CandleStyleAppearance {
  readonly style: 'candles';
  readonly candles: CandleAppearance;
}

/** Hollow candles, which a series of their own draws from the chart's body, border and wick settings. */
export interface HollowCandlesAppearance {
  readonly style: 'hollowCandles';
  readonly candles: CandleAppearance;
}

/** Price bars: the range as a line with the open and the close as ticks off it. */
export interface BarsAppearance {
  readonly style: 'bars';
  readonly colorByPreviousClose: boolean;
  readonly colors: BarDirectionColors;
  readonly thinBars: boolean;
  readonly hlcBars: boolean;
}

/** One value per bar: the line and its two variants plot the same price source with the same width. */
export interface LineStyleAppearance {
  readonly style: 'line' | 'lineWithMarkers' | 'stepLine';
  readonly priceSource: PriceSource;
  readonly color: string;
  readonly lineWidth: BarStyleLineWidth;
}

/** A line with the area under it filled from the top colour down to the bottom one. */
export interface AreaAppearance {
  readonly style: 'area';
  readonly priceSource: PriceSource;
  readonly lineColor: string;
  readonly lineWidth: BarStyleLineWidth;
  readonly fillTop: string;
  readonly fillBottom: string;
}

/** Every bar's close as a column standing on the bottom of the price scale. */
export interface ColumnsAppearance {
  readonly style: 'columns';
  readonly colorByPreviousClose: boolean;
  readonly colors: BarDirectionColors;
}

/** The price source as a line, filled up and down around a level read off the price scale's visible range. */
export interface BaselineAppearance {
  readonly style: 'baseline';
  readonly priceSource: PriceSource;
  /** How far up that range the fill turns around, as a whole percent from its bottom. */
  readonly baseLevel: number;
  readonly topLine: string;
  readonly topFill: string;
  readonly bottomLine: string;
  readonly bottomFill: string;
  readonly lineWidth: BarStyleLineWidth;
}

/** Heikin Ashi candles, which a series of their own draws from the chart's body, border and wick settings. */
export interface HeikinAshiAppearance {
  readonly style: 'heikinAshi';
  readonly candles: CandleAppearance;
}

/**
 * Candles whose body width grows with the bar's volume, which a custom series draws from the chart's
 * body, border and wick settings.
 */
export interface VolumeCandlesAppearance {
  readonly style: 'volumeCandles';
  readonly candles: CandleAppearance;
  /** How far a quiet bar's body narrows against the busiest visible bar, from 0 to 1 of the body width. */
  readonly widthSensitivity: number;
}

/**
 * Renko bricks, which the backend draws from the chart's candles and the chart then draws as candles: the
 * boxes stack on the close alone, so the times on screen order the bricks rather than place them on a clock.
 */
export interface RenkoAppearance {
  readonly style: 'renko';
  readonly candles: CandleAppearance;
  /** Which setting sizes a brick: the ATR, a fixed price distance, or a share of the last close. */
  readonly boxMethod: BoxMethod;
  /** Bars of the average true range a brick spans, read by the `atr` method. */
  readonly atrLength: number;
  /** The fixed price distance a brick spans, read by the `traditional` method. */
  readonly boxSize: number;
  /** The percent of the last close a brick spans, read by the `percentageLtp` method. */
  readonly percentage: number;
  /** Whether a brick shows the wick it inherited from the bar that drew it. */
  readonly wicks: boolean;
}

/** Line break lines: a new line only when the close turns against the last ones, drawn as candles without wicks. */
export interface LineBreakAppearance {
  readonly style: 'lineBreak';
  readonly candles: CandleAppearance;
  /** How many lines the close has to turn against before a reversal draws one. */
  readonly lines: number;
}

/**
 * Kagi bars: a continuous stepped line the backend draws from the chart's candles, which a custom series paints
 * thick yang where it broke a shoulder and thin yin where it broke a waist.
 */
export interface KagiAppearance {
  readonly style: 'kagi';
  /** Which setting sizes the move that turns the line: the ATR, a fixed price distance, or a share of the close. */
  readonly reversalMethod: BoxMethod;
  /** Bars of the average true range the line has to travel to turn, read by the `atr` method. */
  readonly atrLength: number;
  /** The fixed price distance the line has to travel to turn, read by the `traditional` method. */
  readonly reversal: number;
  /** The percent of the last close the line has to travel to turn, read by the `percentageLtp` method. */
  readonly percentage: number;
  /** The colour and thickness of the thick style the line takes once it rises above the previous shoulder. */
  readonly yangColor: string;
  readonly yangLineWidth: BarStyleLineWidth;
  /** The colour and thickness of the thin style the line takes once it falls below the previous waist. */
  readonly yinColor: string;
  readonly yinLineWidth: BarStyleLineWidth;
}

/** The range as a box from the low to the high, labelled at both prices, which a custom series draws. */
export interface HighLowAppearance {
  readonly style: 'highLow';
  readonly body: ToggledColor;
  readonly borders: ToggledColor;
  readonly labels: ToggledColor;
}

/**
 * Each bar's exact footprint — a sell column, a buy column and a thin candle between them — which a custom series
 * draws from the rows the host publishes for every bar it read whole. These settings are what the chart asks the
 * host to compute its rows with, and what the bars' cells are drawn as.
 */
export interface VolumeFootprintAppearance {
  readonly style: 'volumeFootprint';
  readonly candles: CandleAppearance;
  /** How wide one row is: the host's automatic ATR rows, or a count of the symbol's ticks. */
  readonly rowSize: ChartFootprintRequest['rowSize'];
  /** The share of a bar's volume its value area covers, in percent. */
  readonly valueAreaPercent: number;
  /** Whether the value area's rows are marked with a dotted line and a marker on each bar. */
  readonly showValueArea: boolean;
  /** The share of opposite volume a row needs to count as an imbalance, in percent. */
  readonly imbalancePercent: number;
  /** Whether each bar's cells are graded through its own range, instead of one shade per side. */
  readonly gradient: boolean;
  /** How the cells are placed: in two columns of their own, or in one they are scaled inside. */
  readonly display: FootprintDisplay;
  /** What the cells write: each side's own value, or what a level makes of both. */
  readonly type: FootprintType;
  /** The unit the cells count in: the volume each side traded, or the trades behind it. */
  readonly values: FootprintValues;
  /** The four shades the sell side's cells are graded through, lightest first. */
  readonly sellShades: readonly string[];
  /** The four shades the buy side's cells are graded through, lightest first. */
  readonly buyShades: readonly string[];
  /** Whether each bar writes the box under its columns holding its delta and the volume it traded. */
  readonly showSummary: boolean;
  /** Whether an imbalanced cell is marked on its outer edge, and the colours of the two sides' marks. */
  readonly imbalanceHighlight: FootprintImbalanceHighlight;
  /** Whether each bar's stacked imbalance zones are drawn, and how many consecutive imbalanced levels one collects. */
  readonly stackedImbalance: FootprintStackedImbalance;
  /** The colour the row a bar traded most at is drawn in, and whether it takes that colour. */
  readonly poc: ToggledColor;
}

/** How many levels an imbalance needs to stack into a zone, and whether the zones are drawn. */
export interface FootprintStackedImbalance {
  readonly visible: boolean;
  readonly count: number;
}

/** How an imbalanced footprint cell is marked: whether the marks are drawn, and each side's colour. */
export interface FootprintImbalanceHighlight {
  readonly visible: boolean;
  readonly buyColor: string;
  readonly sellColor: string;
}

/**
 * Point & figure columns: the backend turns the chart's candles into columns of X and O marks, which a custom
 * series prints on the box grid it reads back off the columns themselves.
 */
export interface PointFigureAppearance {
  readonly style: 'pointFigure';
  /** Which prices a column reads: the bar's high and low, or its close for both. */
  readonly source: PointFigureSource;
  /** Which setting sizes a box: the ATR, a fixed price distance, or a share of the last close. */
  readonly boxMethod: BoxMethod;
  /** Bars of the average true range a box spans, read by the `atr` method. */
  readonly atrLength: number;
  /** The fixed price distance a box spans, read by the `traditional` method. */
  readonly boxSize: number;
  /** The percent of the last close a box spans, read by the `percentageLtp` method. */
  readonly percentage: number;
  /** How many boxes against a column the move must travel before it draws the opposite column. */
  readonly reversal: number;
  /** The colour a rising column's X marks are drawn in, and a falling column's O marks. */
  readonly upColor: string;
  readonly downColor: string;
}

/** How the chart draws its bars, which is the one thing the bar style setting decides. */
export type BarStyleAppearance =
  | CandleStyleAppearance
  | HollowCandlesAppearance
  | VolumeCandlesAppearance
  | VolumeFootprintAppearance
  | HeikinAshiAppearance
  | RenkoAppearance
  | LineBreakAppearance
  | KagiAppearance
  | PointFigureAppearance
  | BarsAppearance
  | LineStyleAppearance
  | AreaAppearance
  | BaselineAppearance
  | ColumnsAppearance
  | HighLowAppearance;

/**
 * The appearances the bar style series draws itself; plain candles are the anchor series' own, so they
 * leave a second series no point to write.
 */
export type DrawnBarStyleAppearance = Exclude<BarStyleAppearance, { style: 'candles' }>;

/** The appearances a custom series draws, each with a pane view of its own that no other style can swap into. */
export type CustomBarStyleAppearance = Extract<
  DrawnBarStyleAppearance,
  { style: 'highLow' | 'volumeCandles' | 'volumeFootprint' | 'kagi' | 'pointFigure' }
>;

/** The appearances a library series type of its own draws. */
export type LibraryBarStyleAppearance = Exclude<DrawnBarStyleAppearance, CustomBarStyleAppearance>;

/** Whether a custom series draws the style, which is the one thing a library series type cannot paint. */
export function isCustomBarStyle(style: DrawnBarStyleAppearance['style']): style is CustomBarStyleAppearance['style'] {
  return (
    style === 'highLow' ||
    style === 'volumeCandles' ||
    style === 'volumeFootprint' ||
    style === 'kagi' ||
    style === 'pointFigure'
  );
}

/** What the chart draws before any bar style setting arrives: the candles it has always drawn. */
export const DEFAULT_BAR_STYLE_APPEARANCE: BarStyleAppearance = {
  style: 'candles',
  candles: DEFAULT_CANDLE_APPEARANCE,
};

function sameColors(first: BarDirectionColors, second: BarDirectionColors): boolean {
  return first.up === second.up && first.down === second.down;
}

function sameBarsAppearance(first: BarsAppearance, second: BarsAppearance): boolean {
  return (
    first.colorByPreviousClose === second.colorByPreviousClose &&
    first.thinBars === second.thinBars &&
    first.hlcBars === second.hlcBars &&
    sameColors(first.colors, second.colors)
  );
}

function sameLineStyleAppearance(first: LineStyleAppearance, second: LineStyleAppearance): boolean {
  return (
    first.priceSource === second.priceSource && first.color === second.color && first.lineWidth === second.lineWidth
  );
}

function sameAreaAppearance(first: AreaAppearance, second: AreaAppearance): boolean {
  return (
    first.priceSource === second.priceSource &&
    first.lineColor === second.lineColor &&
    first.lineWidth === second.lineWidth &&
    first.fillTop === second.fillTop &&
    first.fillBottom === second.fillBottom
  );
}

function sameColumnsAppearance(first: ColumnsAppearance, second: ColumnsAppearance): boolean {
  return first.colorByPreviousClose === second.colorByPreviousClose && sameColors(first.colors, second.colors);
}

function sameToggledColor(first: ToggledColor, second: ToggledColor): boolean {
  return first.visible === second.visible && first.color === second.color;
}

function sameVolumeCandlesAppearance(first: VolumeCandlesAppearance, second: VolumeCandlesAppearance): boolean {
  return sameCandleAppearance(first.candles, second.candles) && first.widthSensitivity === second.widthSensitivity;
}

/** Whether two row widths name the same rows: the same ATR length, or the same count of ticks. */
function sameRowSize(
  first: VolumeFootprintAppearance['rowSize'],
  second: VolumeFootprintAppearance['rowSize'],
): boolean {
  if (first.kind === 'auto' && second.kind === 'auto') {
    return first.atrLength === second.atrLength;
  }
  return first.kind === 'manual' && second.kind === 'manual' && first.ticksPerRow === second.ticksPerRow;
}

function sameImbalanceHighlight(first: FootprintImbalanceHighlight, second: FootprintImbalanceHighlight): boolean {
  return first.visible === second.visible && first.buyColor === second.buyColor && first.sellColor === second.sellColor;
}

function sameStackedImbalance(first: FootprintStackedImbalance, second: FootprintStackedImbalance): boolean {
  return first.visible === second.visible && first.count === second.count;
}

function sameShades(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((shade, index) => shade === second[index]);
}

function sameVolumeFootprintAppearance(first: VolumeFootprintAppearance, second: VolumeFootprintAppearance): boolean {
  return (
    sameCandleAppearance(first.candles, second.candles) &&
    sameRowSize(first.rowSize, second.rowSize) &&
    first.valueAreaPercent === second.valueAreaPercent &&
    first.showValueArea === second.showValueArea &&
    first.imbalancePercent === second.imbalancePercent &&
    first.gradient === second.gradient &&
    first.display === second.display &&
    first.type === second.type &&
    first.values === second.values &&
    sameShades(first.sellShades, second.sellShades) &&
    sameShades(first.buyShades, second.buyShades) &&
    first.showSummary === second.showSummary &&
    sameImbalanceHighlight(first.imbalanceHighlight, second.imbalanceHighlight) &&
    sameStackedImbalance(first.stackedImbalance, second.stackedImbalance) &&
    sameToggledColor(first.poc, second.poc)
  );
}

function sameHighLowAppearance(first: HighLowAppearance, second: HighLowAppearance): boolean {
  return (
    sameToggledColor(first.body, second.body) &&
    sameToggledColor(first.borders, second.borders) &&
    sameToggledColor(first.labels, second.labels)
  );
}

function sameBaselineAppearance(first: BaselineAppearance, second: BaselineAppearance): boolean {
  return (
    first.priceSource === second.priceSource &&
    first.baseLevel === second.baseLevel &&
    first.topLine === second.topLine &&
    first.topFill === second.topFill &&
    first.bottomLine === second.bottomLine &&
    first.bottomFill === second.bottomFill &&
    first.lineWidth === second.lineWidth
  );
}

/**
 * Whether two Renko settings ask the backend for the same bricks, whatever colours the chart paints them with:
 * the box method and the length, distance or percentage it sizes a brick with.
 */
export function sameRenkoParameters(first: RenkoAppearance, second: RenkoAppearance): boolean {
  return (
    first.boxMethod === second.boxMethod &&
    first.atrLength === second.atrLength &&
    first.boxSize === second.boxSize &&
    first.percentage === second.percentage &&
    first.wicks === second.wicks
  );
}

function sameRenkoAppearance(first: RenkoAppearance, second: RenkoAppearance): boolean {
  return sameCandleAppearance(first.candles, second.candles) && sameRenkoParameters(first, second);
}

function sameLineBreakAppearance(first: LineBreakAppearance, second: LineBreakAppearance): boolean {
  return sameCandleAppearance(first.candles, second.candles) && first.lines === second.lines;
}

/**
 * Whether two Kagi settings ask the backend for the same line, whatever colours the chart paints it with: the
 * reversal method and the length, distance or percentage it sizes a stroke with.
 */
export function sameKagiParameters(first: KagiAppearance, second: KagiAppearance): boolean {
  return (
    first.reversalMethod === second.reversalMethod &&
    first.atrLength === second.atrLength &&
    first.reversal === second.reversal &&
    first.percentage === second.percentage
  );
}

function sameKagiAppearance(first: KagiAppearance, second: KagiAppearance): boolean {
  return (
    sameKagiParameters(first, second) &&
    first.yangColor === second.yangColor &&
    first.yangLineWidth === second.yangLineWidth &&
    first.yinColor === second.yinColor &&
    first.yinLineWidth === second.yinLineWidth
  );
}

/**
 * Whether two Point & figure settings ask the backend for the same columns, whatever colours the chart prints
 * them in: the prices a column reads, the method that sizes its boxes and how far a reversal runs.
 */
export function samePointFigureParameters(first: PointFigureAppearance, second: PointFigureAppearance): boolean {
  return (
    first.source === second.source &&
    first.boxMethod === second.boxMethod &&
    first.atrLength === second.atrLength &&
    first.boxSize === second.boxSize &&
    first.percentage === second.percentage &&
    first.reversal === second.reversal
  );
}

function samePointFigureAppearance(first: PointFigureAppearance, second: PointFigureAppearance): boolean {
  const colors = first.upColor === second.upColor && first.downColor === second.downColor;
  return samePointFigureParameters(first, second) && colors;
}

/** Whether two appearances draw the same bars, so a setting that did not change costs no repaint. */
export function sameBarStyleAppearance(first: BarStyleAppearance, second: BarStyleAppearance): boolean {
  switch (first.style) {
    case 'candles':
    case 'hollowCandles':
    case 'heikinAshi':
      return second.style === first.style && sameCandleAppearance(first.candles, second.candles);
    case 'renko':
      return second.style === 'renko' && sameRenkoAppearance(first, second);
    case 'lineBreak':
      return second.style === 'lineBreak' && sameLineBreakAppearance(first, second);
    case 'kagi':
      return second.style === 'kagi' && sameKagiAppearance(first, second);
    case 'pointFigure':
      return second.style === 'pointFigure' && samePointFigureAppearance(first, second);
    case 'volumeCandles':
      return second.style === 'volumeCandles' && sameVolumeCandlesAppearance(first, second);
    case 'volumeFootprint':
      return second.style === 'volumeFootprint' && sameVolumeFootprintAppearance(first, second);
    case 'bars':
      return second.style === 'bars' && sameBarsAppearance(first, second);
    case 'line':
      return second.style === 'line' && sameLineStyleAppearance(first, second);
    case 'lineWithMarkers':
      return second.style === 'lineWithMarkers' && sameLineStyleAppearance(first, second);
    case 'stepLine':
      return second.style === 'stepLine' && sameLineStyleAppearance(first, second);
    case 'area':
      return second.style === 'area' && sameAreaAppearance(first, second);
    case 'baseline':
      return second.style === 'baseline' && sameBaselineAppearance(first, second);
    case 'columns':
      return second.style === 'columns' && sameColumnsAppearance(first, second);
    case 'highLow':
      return second.style === 'highLow' && sameHighLowAppearance(first, second);
  }
}
