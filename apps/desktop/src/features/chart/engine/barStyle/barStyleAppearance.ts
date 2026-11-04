import { DEFAULT_CANDLE_APPEARANCE, sameCandleAppearance, type CandleAppearance } from '../bars/candleAppearance';
import type { PriceSource } from './priceSource';

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

/** How the chart draws its bars, which is the one thing the bar style setting decides. */
export type BarStyleAppearance =
  | CandleStyleAppearance
  | HollowCandlesAppearance
  | HeikinAshiAppearance
  | BarsAppearance
  | LineStyleAppearance
  | AreaAppearance
  | BaselineAppearance
  | ColumnsAppearance;

/**
 * The appearances the bar style series draws itself; plain candles are the anchor series' own, so they
 * leave a second series no point to write.
 */
export type DrawnBarStyleAppearance = Exclude<BarStyleAppearance, { style: 'candles' }>;

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

/** Whether two appearances draw the same bars, so a setting that did not change costs no repaint. */
export function sameBarStyleAppearance(first: BarStyleAppearance, second: BarStyleAppearance): boolean {
  switch (first.style) {
    case 'candles':
    case 'hollowCandles':
    case 'heikinAshi':
      return second.style === first.style && sameCandleAppearance(first.candles, second.candles);
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
  }
}
