import {
  type IChartApi,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { PRICE_SCALE_ID } from '../priceScale/priceScaleId';
import type { BaselineAppearance } from './barStyleAppearance';
import { priceAt } from './priceSource';

/** The baseline's level is a whole percent: a hundred steps from the bottom of the range to its top. */
const WHOLE_PERCENT = 100;

/** What the level reads off the saved appearance: its share of the range and the price it falls back to. */
type BaselineLevelSetting = Pick<BaselineAppearance, 'baseLevel' | 'priceSource'>;

/** The price a baseline fills around, as the library's own base value. */
export function priceBaseValue(price: number) {
  return { type: 'price' as const, price };
}

/** The price `levelPercent` of the way up a visible price range, whose `from` is its lowest price. */
function basePriceIn(range: { from: number; to: number }, levelPercent: number): number {
  return range.from + ((range.to - range.from) * levelPercent) / WHOLE_PERCENT;
}

/** Whether two settings put the level at the same price. */
function sameLevel(setting: BaselineLevelSetting, applied: BaselineLevelSetting): boolean {
  return setting.baseLevel === applied.baseLevel && setting.priceSource === applied.priceSource;
}

/**
 * The price a baseline series fills around: `baseLevel` percent of the way up the price scale's visible
 * range, which the library recomputes during its paint — after the time scale's range listeners have run.
 * So the level rides on the baseline series as a primitive, because `updateAllViews()` is the one hook the
 * library calls once the range for that paint is set.
 */
export class BaselineLevel implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  /** The bar the level falls back to while the price scale knows no range, as the series plots them. */
  private lastBar: RenderBar | undefined;
  /** The price last written to the series, which the guard against an endless repaint compares with. */
  private appliedPrice: number | null = null;

  constructor(private setting: BaselineLevelSetting) {}

  /** The price the series' fill is at, or none before the first paint applies one. */
  basePrice(): number | null {
    return this.appliedPrice;
  }

  /** Takes the level the saved appearance holds; the paint that follows is what applies its price. */
  setLevel(setting: BaselineLevelSetting): void {
    if (sameLevel(setting, this.setting)) {
      return;
    }
    this.setting = setting;
    this.requestUpdate?.();
  }

  /** The bar the last write left; the level falls back to its price while the scale knows no range. */
  setLastBar(bar: RenderBar | undefined): void {
    this.lastBar = bar;
  }

  /**
   * Moves the series' base value to the level's price, re-reading the visible range the paint resolved
   * by the time this runs.
   */
  updateAllViews(): void {
    this.applyLevel();
  }

  /** The series draws its own fill, so the level has nothing to paint. */
  paneViews(): readonly IPrimitivePaneView[] {
    return [];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    // A series added later starts on the library's default base value, so the level is applied afresh.
    this.appliedPrice = null;
  }

  /** The price the level is at now: the range's share, or the last bar's while the range is unknown. */
  private levelPrice(): number | null {
    const range = this.chart === null ? null : this.chart.priceScale(PRICE_SCALE_ID).getVisibleRange();
    if (range !== null) {
      return basePriceIn(range, this.setting.baseLevel);
    }
    const lastBar = this.lastBar;
    return lastBar === undefined ? null : priceAt(lastBar, this.setting.priceSource);
  }

  /** Writes the level's price to the series, and only when it moved. */
  private applyLevel(): void {
    const series = this.series;
    if (series === null) {
      return;
    }
    const price = this.levelPrice();
    if (price === null || price === this.appliedPrice) {
      return;
    }
    this.appliedPrice = price;
    // A base value is a series option, so writing it repaints and brings this hook back: the price
    // recorded above is what the next call compares against, and that is what ends the repaint.
    series.applyOptions({ baseValue: priceBaseValue(price) });
  }
}
