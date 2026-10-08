import { timeframeBarOffset } from '../../../shared/bridge/timeframes';
import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from 'lightweight-charts';
import { setPriceScaleRange } from './priceScaleRange';
import type { RenderBar } from './mt5DataAdapter';
import type { RenderViewport } from './overlayTypes';
import { END_MARGIN, futurePoints, neededFutureBarCount, timeScaleBaseIndex } from './futureTimePoints';

/** Follow only near the real last candle's five-bar end anchor. */
const AT_END_TOLERANCE_BARS = 5;

/**
 * Where the pane sat, captured before the series is replaced.
 *
 * Logical indices address a different bar once the bar count changes, so what
 * carries over is the distance from the right edge measured in bars. Bar spacing
 * survives the swap untouched, which makes that the same number of pixels: the
 * view stays exactly where the user left it instead of drifting toward the newest
 * candles or parking past the end of a shorter series.
 */
export interface ViewportAnchor {
  /** Bars between the pane's right edge and the default end anchor. */
  barsFromEnd: number;
}

/** The bar facts the time scale is derived from; written by BarSeriesController. */
export interface TimeModel {
  readonly bars: readonly RenderBar[];
  readonly timeframe: string;
  readonly intervalSeconds: number;
  lastBar(): RenderBar | undefined;
}

/**
 * True when a pointer lies outside a pane of this size. The Cross tool hides
 * rather than clamping, because a clamped crosshair would print a time or price
 * the pointer is not over.
 *
 * This is deliberately the raw bounds test rather than the negation of an
 * "is inside" predicate: the two disagree for a non-finite coordinate, where
 * this form keeps the pointer on its normal path instead of hiding the crosshair.
 */
export function isOutsidePane(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x > width || y > height;
}

/**
 * Owns everything the time scale determines: the pane geometry, the helper
 * points that extend the scale past the last real bar, the follow anchor and the
 * coordinate conversions.
 *
 * These belong together because they are one invariant. Extending the helper
 * points changes the library's base index, which re-derives the viewport, and
 * the right offset that writes re-fires the subscription that extends them again
 * — so separating them invites either a feedback loop or a scheduled frame that
 * outlives the chart.
 */
export class ViewportController {
  private futureCount = 0;
  private futureFrame = 0;
  /** Pane size in host CSS px, refreshed on layout and on every repaint. */
  private paneWidth = 0;
  private paneHeight = 0;
  private retainedPrices: { minValue: number; maxValue: number } | null = null;
  /**
   * Set by the controller: reports every visible-range change. This is the only
   * signal lazy loading has that the user moved the pane over a gap.
   */
  onViewportChanged?: () => void;

  constructor(
    private readonly chart: IChartApi,
    private readonly candles: ISeriesApi<'Candlestick'>,
    private readonly future: ISeriesApi<'Line'>,
    private readonly data: TimeModel,
    private readonly isDisposed: () => boolean,
  ) {}

  /** Starts watching the time scale, which decides when more helper points are needed. */
  start(): void {
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRangeChange);
  }

  destroy(): void {
    cancelAnimationFrame(this.futureFrame);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRangeChange);
  }

  visibleRange(): { from: number; to: number } | null {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    return range ? { from: Number(range.from), to: Number(range.to) } : null;
  }

  isFollowing(): boolean {
    const range = this.visibleRange();
    return (
      range !== null &&
      Math.abs(range.to - timeScaleBaseIndex(this.data.bars.length, END_MARGIN)) <= AT_END_TOLERANCE_BARS
    );
  }

  /**
   * True when the pane shows empty space before the oldest real bar. Logical 0
   * is the first bar, so a negative `from` is the gap past the start of the
   * data. The right-hand end margin is a `rightOffset` and never makes `from`
   * negative, so it cannot trigger lazy loading.
   */
  isBeforeHistory(): boolean {
    const range = this.visibleRange();
    return range !== null && range.from < 0;
  }

  /**
   * Re-anchors the pane after bars were prepended: every existing bar moved from
   * logical index `i` to `i + added`, so shifting the range by the same amount
   * keeps the visible bars exactly where they were and consumes precisely the
   * empty space that requested the page.
   */
  anchorAfterPrepend(previous: { from: number; to: number } | null, added: number): void {
    if (!previous) {
      return;
    }
    this.chart.timeScale().setVisibleLogicalRange({ from: previous.from + added, to: previous.to + added });
  }

  diagnosticViewport() {
    const range = this.visibleRange();
    const spacing = this.chart.timeScale().options().barSpacing;
    const width = this.chart.timeScale().width();
    return {
      offset: range ? range.from * spacing : 0,
      endAnchor: timeScaleBaseIndex(this.data.bars.length, END_MARGIN) * spacing - width,
      followArmed: this.isFollowing(),
    };
  }

  /** Pane size in host CSS px as last measured, which is what pointer hit-tests need. */
  paneSize(): { width: number; height: number } {
    return { width: this.paneWidth, height: this.paneHeight };
  }

  measurePane(): void {
    this.paneWidth = this.chart.timeScale().width();
    this.paneHeight = this.chart.panes()[0]?.getHeight() ?? 0;
  }

  /** Extends the helper points when the pane needs more of them than the last rebuild left. */
  ensureFuture(width: number, barSpacing: number): void {
    if (this.futureCount < neededFutureBarCount(width, barSpacing)) {
      this.extendFuture(barSpacing);
    }
  }

  /** Drops the helper points, so the next extendFuture rebuilds them for new bars. */
  resetFuture(): void {
    this.futureCount = 0;
  }

  clearRetainedPrices(): void {
    this.retainedPrices = null;
  }

  /** Restores the default zoom and the end anchor, and fits the price scale. */
  resetToEnd(): void {
    // A pending helper rebuild would preserve the old visible range after this
    // explicit reset, replacing the new end anchor with a stale one.
    cancelAnimationFrame(this.futureFrame);
    this.futureFrame = 0;
    const scale = this.chart.timeScale();
    this.ensureFuture(scale.width(), 10);
    const to = timeScaleBaseIndex(this.data.bars.length, END_MARGIN);
    this.restoreViewport(to, 10);
    this.fitPriceScale(to, 10);
  }

  restoreViewport(to: number, barSpacing: number): void {
    // Applying range bounds also derives zoom from the current pane width.
    // Preserve zoom explicitly while helper points change the library's base
    // index; this remains stable through consecutive drawer resize frames.
    const baseIndex = timeScaleBaseIndex(this.data.bars.length, this.futureCount);
    this.chart.timeScale().applyOptions({ barSpacing, rightOffset: to - baseIndex });
  }

  extendFuture(barSpacing = this.chart.timeScale().options().barSpacing): void {
    const last = this.data.lastBar();
    if (!last) {
      this.future.setData([]);
      return;
    }
    const scale = this.chart.timeScale();
    const spacing = barSpacing;
    const count = neededFutureBarCount(scale.width(), spacing);
    const range = this.visibleRange();
    // Rebuilt only on a new real bar or resize; never on an existing-bar tick.
    this.future.setData(
      futurePoints(last.time, this.data.timeframe, last.close, count).map(({ time, value }) => ({
        time: time as UTCTimestamp,
        value,
      })),
    );
    this.futureCount = count;
    if (range) {
      this.restoreViewport(range.to, spacing);
    }
  }

  viewport(): RenderViewport {
    const width = this.chart.timeScale().width();
    const height = this.chart.panes()[0].getHeight();
    this.paneWidth = width;
    this.paneHeight = height;
    const range = this.visibleRange() ?? { from: 0, to: 0 };
    const barWidth = this.chart.timeScale().options().barSpacing;
    const min = this.candles.coordinateToPrice(height) ?? this.retainedPrices?.minValue ?? 0;
    const max = this.candles.coordinateToPrice(0) ?? this.retainedPrices?.maxValue ?? 1;
    if (max > min) {
      this.retainedPrices = { minValue: min, maxValue: max };
    }
    return {
      chartRect: { x: 0, y: 0, width, height },
      priceRange: { min, max },
      visibleRange: range,
      barWidth,
      barSpacing: 0,
      offset: range.from * barWidth,
      priceToY: (price) => this.candles.priceToCoordinate(price) ?? NaN,
      yToPrice: (y) => this.candles.coordinateToPrice(y) ?? NaN,
      timeToX: (timeMs) => this.timeToX(timeMs),
    };
  }

  timeToX(timeMs: number): number {
    const index = this.logicalAtTime(timeMs);
    if (!Number.isFinite(index)) {
      return NaN;
    }
    // LWC 5.2 accepts integer logical indices here and returns zero for a
    // fractional one. Interpolate pixels using its public bar spacing.
    const whole = Math.floor(index);
    const x = this.chart.timeScale().logicalToCoordinate(whole as Logical);
    return x === null ? NaN : x + (index - whole) * this.chart.timeScale().options().barSpacing;
  }

  /**
   * The pane's position, for carrying the view over a series replacement. Null
   * while there is nothing to describe it.
   */
  visibleAnchor(): ViewportAnchor | null {
    const range = this.visibleRange();
    if (range === null || !this.data.bars.length) {
      return null;
    }
    return { barsFromEnd: timeScaleBaseIndex(this.data.bars.length, END_MARGIN) - range.to };
  }

  /**
   * Restores the offset from the right edge against the replaced series, so the
   * view keeps the position it had rather than jumping to the newest candles.
   *
   * A position deeper in history than this series reaches lands on its oldest bar:
   * the pane keeps the offset instead of being dragged right, and the space that
   * leaves behind is filled by the page `replaceHistory` asks for. Moving the pane
   * right to fill itself is the other way to avoid an empty chart, and it is the
   * wrong one — the view is supposed to stay where it was put.
   *
   * A position *past* the last bar is not clamped at all. Empty space to the right
   * of the newest candle is a place the user scrolled to, and every series carries
   * the same end margin, so the same offset is always available in the new one.
   * Clamping it to the end anchor pulled that view back to the newest candles.
   *
   * Returns false only when there is no series to anchor against.
   */
  restoreVisibleAnchor(anchor: ViewportAnchor, barSpacing: number): boolean {
    const bars = this.data.bars;
    if (!bars.length) {
      return false;
    }
    const end = timeScaleBaseIndex(bars.length, END_MARGIN);
    const to = Math.max(end - anchor.barsFromEnd, 0);
    this.restoreViewport(to, barSpacing);
    this.fitPriceScale(to, barSpacing);
    return true;
  }

  /**
   * Fits the price scale to the candles a viewport ending at `to` shows.
   *
   * Auto scale is off by default, and the library keeps the current range across a
   * data replacement — the next symbol's prices would draw off the pane — so a new
   * series is fitted here, in the same task that decided the viewport, and no frame
   * is drawn with the old range on new candles. The range is the high/low extent of
   * the candles the pane shows, which is what the library's own fit reports for
   * them. It then holds until the next replacement, which is the point: a tick no
   * longer rescales the pane.
   */
  private fitPriceScale(to: number, barSpacing: number): void {
    const scale = this.candles.priceScale();
    const bars = this.data.bars;
    if (scale.options().autoScale || !bars.length) {
      return;
    }
    const paneBars = Math.max(1, Math.ceil(this.chart.timeScale().width() / barSpacing));
    const first = Math.max(0, Math.floor(to - paneBars));
    const last = Math.min(bars.length - 1, Math.ceil(to));
    let low = Infinity;
    let high = -Infinity;
    for (let index = first; index <= last; index += 1) {
      low = Math.min(low, bars[index].low);
      high = Math.max(high, bars[index].high);
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return;
    }
    if (high <= low) {
      // A window of identical candles has no extent to fit; pad by the symbol's
      // smallest price step so the range still contains them.
      const format = this.candles.options().priceFormat;
      const padding = format.type === 'price' ? format.minMove : 0.01;
      low -= padding;
      high += padding;
    }
    setPriceScaleRange(this.candles, { from: low, to: high });
  }

  /** Fractional logical index of a time, per the bar cache. */
  private logicalAtTime(timeMs: number): number {
    const bars = this.data.bars;
    if (!bars.length || !Number.isFinite(timeMs)) {
      return NaN;
    }
    const time = timeMs / 1000;
    let lo = 0,
      hi = bars.length - 1;
    if (time <= bars[0].time) {
      hi = 0;
    } else if (time >= bars[hi].time) {
      lo = hi;
    } else {
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (bars[mid].time === time) {
          lo = mid;
          hi = mid;
          break;
        }
        if (bars[mid].time < time) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
    let index: number;
    if (time >= bars[bars.length - 1].time) {
      // A minute selection can lie inside the current hourly candle. Retain
      // its sub-bar time rather than collapsing both boundaries to its open.
      index = bars.length - 1 + timeframeBarOffset(this.data.timeframe, bars[bars.length - 1].time, time);
    } else if (lo === hi) {
      index = lo;
    } else if (hi < 0) {
      index = 0;
    } else if (lo >= bars.length) {
      index = bars.length - 1;
    } else {
      index = hi + (time - bars[hi].time) / (bars[lo].time - bars[hi].time);
    }
    return index;
  }

  /** Bar index under a pane x, or null when the pointer is not over a real bar. */
  barIndexAt(x: number): number | null {
    const logical = this.chart.timeScale().coordinateToLogical(x);
    if (logical === null) {
      return null;
    }
    const index = Math.round(logical);
    return index >= 0 && index < this.data.bars.length ? index : null;
  }

  private readonly onRangeChange = (): void => {
    if (this.isDisposed()) {
      return;
    }
    // Reported before the future-point guard: paging reacts to where the pane
    // moved, which is true whether or not the helper series needs rebuilding.
    this.onViewportChanged?.();
    const scale = this.chart.timeScale();
    const needed = neededFutureBarCount(scale.width(), scale.options().barSpacing);
    if (this.futureFrame || this.futureCount >= needed) {
      return;
    }
    this.futureFrame = requestAnimationFrame(() => {
      this.futureFrame = 0;
      if (!this.isDisposed()) {
        this.extendFuture();
      }
    });
  };
}
