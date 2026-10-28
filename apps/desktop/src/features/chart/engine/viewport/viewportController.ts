import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from 'lightweight-charts';
import type { TimeModel } from '../bars/timeModel';
import { fitPriceScale } from '../priceScale/fitPriceScale';
import type { RenderViewport } from '../surface/overlayRenderer';
import {
  DEFAULT_BAR_SPACING,
  END_MARGIN,
  futurePoints,
  neededFutureBarCount,
  timeScaleBaseIndex,
} from '../timeScale/futureTimePoints';
import { fractionalLogicalIndex } from '../timeScale/logicalIndex';
import { recordViewportChange, type ViewportSnapshot } from './viewportDiagnostics';

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

/** What a gesture diagnostic needs to know about the view: where it sits, where the end anchor is, whether it follows. */
export interface DiagnosticViewport {
  offset: number;
  endAnchor: number;
  followEnabled: boolean;
}

/**
 * True when a pointer lies outside a pane of this size. The crosshair tool hides
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
 * the right offset that writes re-triggers the subscription that extends them again
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
  private queuedWrite: { to: number; barSpacing: number } | null = null;
  private queuedWriteFrame = 0;
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
    cancelAnimationFrame(this.queuedWriteFrame);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRangeChange);
  }

  /**
   * The pane's logical range. While a write is queued the library has not applied
   * it yet, so this answers with the range the write will produce: a second write
   * in the same task (several bars flushed together, a resize after a bar) must
   * start from where the first one is taking the view, not from where it was.
   */
  visibleRange(): { from: number; to: number } | null {
    if (this.queuedWrite) {
      const { to, barSpacing } = this.queuedWrite;
      return { from: to - this.chart.timeScale().width() / barSpacing + 1, to };
    }
    const range = this.chart.timeScale().getVisibleLogicalRange();
    return range ? { from: Number(range.from), to: Number(range.to) } : null;
  }

  /**
   * The library applies `applyOptions` and `setVisibleLogicalRange` at its next
   * paint, not when they are called. The paint callback was registered by that
   * write, so the frame registered here runs after it, once the write has landed.
   */
  private noteQueuedWrite(to: number, barSpacing: number): void {
    this.queuedWrite = { to, barSpacing };
    if (!this.queuedWriteFrame) {
      this.queuedWriteFrame = requestAnimationFrame(() => {
        this.queuedWriteFrame = 0;
        this.queuedWrite = null;
      });
    }
  }

  /**
   * True while the newest bar is on screen, even partly. A zoom or pan that keeps
   * it in view keeps the pane following new bars at the distance the user chose from
   * the right edge; only moving it out of view stops that, and bringing it back
   * resumes it.
   */
  isFollowing(): boolean {
    const range = this.visibleRange();
    const newest = this.data.bars.length - 1;
    return range !== null && newest >= 0 && range.from <= newest + 0.5 && range.to >= newest - 0.5;
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
    this.traced('anchorAfterPrepend', () => {
      const scale = this.chart.timeScale();
      scale.setVisibleLogicalRange({ from: previous.from + added, to: previous.to + added });
      this.noteQueuedWrite(previous.to + added, scale.width() / (previous.to - previous.from + 1));
    });
  }

  /**
   * Runs a write to the time scale and, in development, records the view before
   * and after it. The branch is statically false in a production build.
   */
  traced<T>(caller: string, write: () => T): T {
    if (!import.meta.env.DEV) {
      return write();
    }
    const before = this.snapshot();
    const result = write();
    recordViewportChange(caller, before, this.snapshot());
    return result;
  }

  private snapshot(): ViewportSnapshot {
    return {
      range: this.visibleRange(),
      barCount: this.data.bars.length,
      futureCount: this.futureCount,
      barSpacing: this.chart.timeScale().options().barSpacing,
      following: this.isFollowing(),
    };
  }

  diagnosticViewport(): DiagnosticViewport {
    const range = this.visibleRange();
    const spacing = this.chart.timeScale().options().barSpacing;
    const width = this.chart.timeScale().width();
    return {
      offset: range ? range.from * spacing : 0,
      endAnchor: timeScaleBaseIndex(this.data.bars.length, END_MARGIN) * spacing - width,
      followEnabled: this.isFollowing(),
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

  /**
   * Extends the helper points when the pane needs more of them than the last
   * rebuild left. Sized from the time-scale width, the same measure `extendFuture`
   * builds them from: the host is wider by the price axis, so measuring it asked
   * for a rebuild on every resize, including ones that shrank the pane.
   */
  ensureFuture(barSpacing: number): void {
    if (this.futureCount < neededFutureBarCount(this.chart.timeScale().width(), barSpacing)) {
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
    this.traced('resetToEnd', () => {
      // A pending helper rebuild would preserve the old visible range after this
      // explicit reset, replacing the new end anchor with a stale one.
      cancelAnimationFrame(this.futureFrame);
      this.futureFrame = 0;
      this.ensureFuture(DEFAULT_BAR_SPACING);
      const to = timeScaleBaseIndex(this.data.bars.length, END_MARGIN);
      this.restoreViewport(to, DEFAULT_BAR_SPACING);
      this.fitPrices(to, DEFAULT_BAR_SPACING);
    });
  }

  restoreViewport(to: number, barSpacing: number): void {
    this.traced('restoreViewport', () => {
      if (import.meta.env.DEV) {
        this.assertFutureCountMatchesSeries();
      }
      // Applying range bounds also derives zoom from the current pane width.
      // Preserve zoom explicitly while helper points change the library's base
      // index; this remains stable through consecutive drawer resize frames.
      const baseIndex = timeScaleBaseIndex(this.data.bars.length, this.futureCount);
      this.chart.timeScale().applyOptions({ barSpacing, rightOffset: to - baseIndex });
      this.noteQueuedWrite(to, barSpacing);
    });
  }

  /**
   * The right offset is computed against `futureCount`; if it differs from the
   * helper series' real length the offset lands that many bars off, leaving the
   * newest bars far from the right edge or beyond it.
   */
  private assertFutureCountMatchesSeries(): void {
    const actual = this.future.data().length;
    if (actual !== this.futureCount) {
      console.error(`Viewport helper points out of sync: counted ${this.futureCount}, series holds ${actual}.`);
    }
  }

  extendFuture(barSpacing = this.chart.timeScale().options().barSpacing): void {
    const last = this.data.lastBar();
    if (!last) {
      this.future.setData([]);
      this.futureCount = 0;
      return;
    }
    this.traced('extendFuture', () => {
      const scale = this.chart.timeScale();
      const count = neededFutureBarCount(scale.width(), barSpacing);
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
        this.restoreViewport(range.to, barSpacing);
      }
    });
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
      offset: range.from * barWidth,
      priceToY: (price) => this.priceToY(price),
      yToPrice: (y) => this.yToPrice(y),
      timeToX: (timeMs) => this.timeToX(timeMs),
    };
  }

  /** Pane y of a price, or NaN while the price is off the scale. */
  priceToY(price: number): number {
    return this.candles.priceToCoordinate(price) ?? NaN;
  }

  /** Price under a pane y, or NaN while the scale has no range. */
  yToPrice(y: number): number {
    return this.candles.coordinateToPrice(y) ?? NaN;
  }

  timeToX(timeMs: number): number {
    const index = fractionalLogicalIndex(this.data.bars, this.data.timeframe, timeMs);
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
    this.fitPrices(to, barSpacing);
    return true;
  }

  /** Whole logical slot under a pane x; past the newest bar it counts the empty future slots. */
  slotAt(x: number): number | null {
    const logical = this.chart.timeScale().coordinateToLogical(x);
    return logical === null ? null : Math.round(logical);
  }

  /** Fits the price scale to the candles a viewport ending at `to` shows. */
  private fitPrices(to: number, barSpacing: number): void {
    fitPriceScale(this.candles, this.data.bars, { to, barSpacing, paneWidth: this.chart.timeScale().width() });
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
