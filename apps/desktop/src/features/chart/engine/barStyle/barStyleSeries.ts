import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import {
  DEFAULT_BAR_STYLE_APPEARANCE,
  sameBarStyleAppearance,
  type BarStyleAppearance,
  type DrawnBarStyleAppearance,
} from './barStyleAppearance';
import { barStylePoint, barStylePoints, directionColor as colorOfDirection } from './barStylePoints';
import { barBodyColor, barDirectionColors } from './barBodyColor';
import { canRepaintBarStyleSeries, drawBarStyleSeries } from './barStyleSeriesFactory';
import { BaselineLevel, priceBaseValue } from './baselineLevel';
import { HeikinAshiChain } from './heikinAshi';

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
  private options: Readonly<Record<string, unknown>> = {};
  /** The style the series in place draws, which decides whether it can be repainted or must be replaced. */
  private drawnStyle: DrawnBarStyleAppearance['style'] | null = null;
  private priceDigits = 2;
  /** The Heikin Ashi bars written so far, which every bar of that style chains on. */
  private readonly heikinAshiChain = new HeikinAshiChain();
  /** The baseline's level, carried by the baseline series as its primitive. */
  private baselineLevel: BaselineLevel | null = null;

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
