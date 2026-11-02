import type { IChartApi } from 'lightweight-charts';
import type { Candle } from '../../../../shared/bridge/types';
import { toRenderBar } from '../bars/renderBar';
import type { BarSeriesController } from '../bars/barSeriesController';
import type { PointerCandleHold } from '../bars/pointerCandleHold';
import type { ViewportController } from '../viewport/viewportController';

/** What applying a live candle writes in the bar cache. */
type LiveBarCache = Pick<BarSeriesController, 'apply' | 'lastBar'>;

/** What applying a live candle needs from the pane: where it sits, and how to keep it there. */
type LivePane = Pick<ViewportController, 'visibleRange' | 'isFollowing' | 'extendFuture' | 'restoreViewport'>;

/** What the rest of the surface must do around a live candle; this class owns the ordering. */
interface LiveBarHooks {
  /** True once the surface is destroyed, when no write may reach the chart any more. */
  isDisposed(): boolean;
  /** Puts the pane on the end anchor once the series' first bar has arrived. */
  resetView(): void;
  /** Brings everything that reads the bars up to date after they changed. */
  barsChanged(): void;
}

/**
 * Applies the live candle's ticks to the bar cache and keeps the pane where the user left it: a
 * new bar extends the helper points, and a pane that is following the newest candle moves with it.
 *
 * A tick the surface cannot place is dropped rather than drawn: outside a chart that still exists,
 * while a held candle is being placed, for a candle the series has no bar for, and for one older
 * than the last bar already applied.
 */
export class LiveBarController {
  constructor(
    private readonly chart: IChartApi,
    private readonly bars: LiveBarCache,
    private readonly pane: LivePane,
    private readonly heldCandles: Pick<PointerCandleHold, 'hold'>,
    private readonly hooks: LiveBarHooks,
  ) {}

  apply(candle: Candle): void {
    if (this.hooks.isDisposed()) {
      return;
    }
    if (this.heldCandles.hold(candle)) {
      return;
    }
    const bar = toRenderBar(candle);
    if (!bar) {
      return;
    }
    const last = this.bars.lastBar();
    if (last && bar.time < last.time) {
      return;
    }
    const range = this.pane.visibleRange();
    const follows = this.pane.isFollowing();
    const spacing = this.chart.timeScale().options().barSpacing;
    if (this.bars.apply(bar)) {
      this.pane.extendFuture();
      if (range) {
        this.pane.restoreViewport(range.to + (follows ? 1 : 0), spacing);
      }
    }
    if (!last) {
      this.hooks.resetView();
    }
    this.hooks.barsChanged();
  }
}
