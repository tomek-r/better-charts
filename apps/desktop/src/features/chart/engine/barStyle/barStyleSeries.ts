import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import {
  DEFAULT_BAR_STYLE_APPEARANCE,
  sameBarStyleAppearance,
  type BarStyleAppearance,
  type DrawnBarStyleAppearance,
} from './barStyleAppearance';
import {
  barStylePoint,
  barStylePoints,
  directionColor as colorOfDirection,
  type BarFootprints,
  type BarStylePoint,
} from './barStylePoints';
import { barBodyColor, barDirectionColors } from './barBodyColor';
import { canRepaintBarStyleSeries, drawBarStyleSeries } from './barStyleSeriesFactory';
import { BaselineLevel, priceBaseValue } from './baselineLevel';
import { HeikinAshiChain } from './heikinAshi';
import type { BarFootprint, ChartFootprintRow } from './volumeFootprint/footprintData';

/** How often the series wrote its points: a whole rewrite, or one bar's point at a time. */
export interface BarStyleWrites {
  /** The writes of every point at once, each a `setData` over the whole window. */
  readonly data: number;
  /** The writes of a single bar's point, each a `series.update` for the newest bar. */
  readonly update: number;
}

/** The bar style series as the test hook shows it: its style, series type, options, points and writes. */
export interface BarStyleSeriesState {
  readonly style: BarStyleAppearance['style'];
  readonly seriesType: string | null;
  readonly options: Record<string, unknown>;
  readonly points: readonly Record<string, unknown>[];
  readonly writes: BarStyleWrites;
}

/** The milliseconds in a second, which turns a footprint's bar time into the second its point is timed at. */
const MS_PER_SECOND = 1000;

/** The second the bar a footprint belongs to opens at, which is how the series keys its points. */
function footprintSeconds(openMs: number): number {
  return Math.floor(openMs / MS_PER_SECOND);
}

/** The footprints keyed the way the points are timed, so each bar's footprint is one lookup. */
function footprintsByBar(footprints: readonly BarFootprint[]): BarFootprints {
  const byBar = new Map<number, BarFootprint>();
  for (const footprint of footprints) {
    byBar.set(footprintSeconds(footprint.openMs), footprint);
  }
  return byBar;
}

/** Whether two drawn rows carry the same numbers, so drawing the second again changes no cell. */
function sameRow(first: ChartFootprintRow, second: ChartFootprintRow): boolean {
  return (
    first.row === second.row &&
    first.downPrice === second.downPrice &&
    first.upPrice === second.upPrice &&
    first.buyVolume === second.buyVolume &&
    first.sellVolume === second.sellVolume &&
    first.buyTrades === second.buyTrades &&
    first.sellTrades === second.sellTrades &&
    first.buyImbalance === second.buyImbalance &&
    first.sellImbalance === second.sellImbalance
  );
}

function sameRows(first: readonly ChartFootprintRow[], second: readonly ChartFootprintRow[]): boolean {
  return first.length === second.length && first.every((row, index) => sameRow(row, second[index]));
}

/** Whether two footprints carry the same numbers, so a republish of one of them paints the same bar. */
function sameFootprint(first: BarFootprint, second: BarFootprint): boolean {
  return (
    first.openMs === second.openMs &&
    first.buyVolume === second.buyVolume &&
    first.sellVolume === second.sellVolume &&
    first.buyTrades === second.buyTrades &&
    first.sellTrades === second.sellTrades &&
    first.poc === second.poc &&
    first.vah === second.vah &&
    first.val === second.val &&
    first.volume === second.volume &&
    sameRows(first.rows, second.rows)
  );
}

/** Whether two published sets hold the same footprints, so republishing one of them needs no write at all. */
function sameFootprints(first: BarFootprints, second: BarFootprints): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const [seconds, footprint] of first) {
    const drawn = second.get(seconds);
    if (drawn === undefined || !sameFootprint(footprint, drawn)) {
      return false;
    }
  }
  return true;
}

/**
 * The second series that draws the chart's bars while the bar style is not candles. The anchor series
 * stays the one every primitive, the price format and the price fit read, so this series draws the bars
 * and nothing else, and it is added last so it paints above them.
 */
export class BarStyleSeries {
  private appearance: BarStyleAppearance = DEFAULT_BAR_STYLE_APPEARANCE;
  private series: ISeriesApi<SeriesType> | null = null;
  private options: Readonly<Record<string, unknown>> = {};
  /** The style the series in place draws, which decides whether it can be repainted or must be replaced. */
  private drawnStyle: DrawnBarStyleAppearance['style'] | null = null;
  private priceDigits = 2;
  /** Whether the bars are hidden, which the series holds as its own `visible` option. */
  private barsHidden = false;
  /** The Heikin Ashi bars written so far, which every bar of that style chains on. */
  private readonly heikinAshiChain = new HeikinAshiChain();
  /** The baseline's level, carried by the baseline series as its primitive. */
  private baselineLevel: BaselineLevel | null = null;
  /** The footprints the host published, keyed by bar time; a bar it holds none for draws as a plain candle. */
  private footprints: BarFootprints = new Map();
  /** The writes made so far, whose counts the test hook copies out to prove what a publish costs. */
  private readonly writeCount = { data: 0, update: 0 };

  constructor(private readonly chart: IChartApi) {}

  /**
   * Draws `appearance` over `bars`. A style of another series cannot be repainted into the new one, so a
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
    this.writePoints(series, barStylePoints(appearance, plotted, this.footprints));
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
    const footprint = this.footprints.get(plotted.bar.time);
    this.writePoint(series, barStylePoint(appearance, plotted.bar, plotted.previous, footprint));
  }

  /**
   * Replaces the footprints the host published and rewrites the points, so the footprint style draws the rows of
   * every bar it holds one for. Every other style plots the bars alone, so its points are unchanged. The host
   * republishing the footprints the series already holds would paint the same cells again, so it writes nothing.
   */
  applyFootprints(footprints: readonly BarFootprint[], bars: readonly RenderBar[]): void {
    const next = footprintsByBar(footprints);
    if (sameFootprints(next, this.footprints)) {
      return;
    }
    this.footprints = next;
    this.replaceBars(bars);
  }

  /**
   * Draws the footprint the host republished for its forming bar, which is the one bar that changed since the
   * window was read. Only the footprint style's points carry a footprint, and only the series' newest point can be
   * written on its own, so a forming read costs one `update` with every other point left exactly as it was. A
   * footprint of a bar that is not the newest point falls back to the whole rewrite.
   */
  applyFormingFootprint(footprint: BarFootprint, bars: readonly RenderBar[]): void {
    const seconds = footprintSeconds(footprint.openMs);
    this.footprints = new Map(this.footprints).set(seconds, footprint);
    const series = this.series;
    const appearance = this.drawnAppearance();
    if (series === null || appearance === null || appearance.style !== 'volumeFootprint') {
      // No drawn point holds a footprint, so the map alone is everything this write had to change.
      return;
    }
    // The points follow the controller's bars, so the cache's newest bar is the series' newest point. An older
    // one cannot be written in place, and only a whole rewrite reaches it.
    const newest = bars[bars.length - 1];
    if (newest === undefined || newest.time !== seconds) {
      this.replaceBars(bars);
      return;
    }
    this.writePoint(series, barStylePoint(appearance, newest, bars[bars.length - 2], footprint));
  }

  /**
   * The colour the body of the bar at `index` is drawn in, or null while the style draws no up and down
   * colours. For Heikin Ashi it is the drawn candle the chain holds at the cached bar's index, not the raw
   * bar given.
   */
  bodyColor(index: number, bar: RenderBar, previous: RenderBar | undefined): string | null {
    if (this.appearance.style !== 'heikinAshi') {
      return barBodyColor(this.appearance, bar, previous);
    }
    const drawn = this.heikinAshiChain.at(index);
    return barBodyColor(this.appearance, drawn.bar ?? bar, drawn.previous);
  }

  /**
   * The colour the current style gives a rising or a falling bar, whichever bar it is drawn for; null while
   * the style has no up and down colours.
   */
  directionColor(rising: boolean): string | null {
    const colors = barDirectionColors(this.appearance);
    if (colors === null) {
      return null;
    }
    return colorOfDirection(colors, rising);
  }

  /** Applies the anchor series' price precision, which repaints every label a bar style writes. */
  setPrecision(digits: number): void {
    if (digits === this.priceDigits) {
      return;
    }
    this.priceDigits = digits;
    // The style does not change, so this repaints the series in place rather than adding another one.
    this.drawSeries();
  }

  /**
   * Hides the bars this series draws, or shows them again. The series keeps its points, so showing it
   * again paints the bars it already holds, and the baseline's level leaves and comes back with it.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.barsHidden) {
      return;
    }
    this.barsHidden = hidden;
    this.applyBarsHidden();
  }

  /** The series as the test hook shows it, every value a plain copy or a library scalar. */
  state(): BarStyleSeriesState {
    return {
      style: this.appearance.style,
      seriesType: this.series?.seriesType() ?? null,
      options: this.shownOptions(),
      points: this.readPoints(),
      writes: { ...this.writeCount },
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

  /** Rewrites every point of the series, which only a replaced window or a redrawn style needs. */
  private writePoints(series: ISeriesApi<SeriesType>, points: BarStylePoint[]): void {
    series.setData(points);
    this.writeCount.data += 1;
  }

  /** Writes the one point a bar decided, so a live or forming bar costs the series no whole rewrite. */
  private writePoint(series: ISeriesApi<SeriesType>, point: BarStylePoint): void {
    series.update(point);
    this.writeCount.update += 1;
  }

  /** Draws the appearance's series, and the level a baseline fills around. */
  private drawSeries(): void {
    const appearance = this.drawnAppearance();
    if (appearance === null) {
      this.removeSeries();
      return;
    }
    const repainted = this.repaintedSeries(appearance);
    if (repainted === null) {
      // The series in place draws another style, so it leaves before the new one arrives.
      this.removeSeries();
    }
    const drawn = drawBarStyleSeries(this.chart, repainted, appearance, this.priceDigits);
    this.series = drawn.series;
    this.options = drawn.options;
    this.drawnStyle = appearance.style;
    this.syncBaselineLevel(drawn.series, appearance);
    // A series added again for another style starts visible, so the bars' own state is applied to it.
    this.applyBarsHidden();
  }

  /** Writes whether the bars are hidden into the series' options, and into the copy the test hook reads. */
  private applyBarsHidden(): void {
    this.options = { ...this.options, visible: !this.barsHidden };
    this.series?.applyOptions({ visible: !this.barsHidden });
  }

  /** The series in place when it can repaint in the appearance's style, and none when it has to be replaced. */
  private repaintedSeries(appearance: DrawnBarStyleAppearance): ISeriesApi<SeriesType> | null {
    const series = this.series;
    const drawnStyle = this.drawnStyle;
    if (series === null || drawnStyle === null) {
      return null;
    }
    return canRepaintBarStyleSeries(drawnStyle, appearance.style) ? series : null;
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
    this.options = {};
    this.drawnStyle = null;
  }

  /** The options the series was drawn with, plus the base price the level applied since. */
  private shownOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = { ...this.options };
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
