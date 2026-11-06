import type { IChartApi } from 'lightweight-charts';
import type { Candle } from '../../../../shared/bridge/types';
import type { BarSeriesController } from '../bars/barSeriesController';
import { HistoryViewportMode } from '../bars/historyViewportMode';
import { initialHistoryWindow } from '../bars/initialHistoryWindow';
import { OlderHistoryPager } from '../bars/olderHistoryPager';
import type { IndicatorRuntime } from '../indicators/indicatorRuntime';
import type { ViewportController } from '../viewport/viewportController';

/** How a whole history replaces the series: for which timeframe, and where the pane goes afterwards. */
export interface ReplaceHistoryOptions {
  /** The timeframe the history belongs to; omitted keeps the default one. */
  timeframe?: string;
  viewportMode?: HistoryViewportMode;
}

/** What the chart's history works on: the surface, what it acts through, and who hears about the result. */
export interface ChartHistoryOptions {
  readonly chart: IChartApi;
  readonly view: ViewportController;
  readonly data: BarSeriesController;
  readonly indicators: IndicatorRuntime;
  /** Read on every replacement: the controller builds this collaborator before it can report teardown. */
  readonly isDestroyed: () => boolean;
  /** Candles held for the live bar belong to the replaced series; read on call, as the hold is built later. */
  readonly discardHeldCandles: () => void;
  /** Told once the bars changed, so the readouts, overlays and tools catch up. */
  readonly barsChanged: () => void;
  readonly refreshOverlays: () => void;
}

/**
 * The chart's history: replacing the whole series, paging older bars in, and how many bars to ask for
 * first. It holds the order those steps run in, since a replaced series invalidates the paging and the
 * candles held for the old one.
 */
export class ChartHistory {
  private readonly pager: OlderHistoryPager;

  constructor(private readonly options: ChartHistoryOptions) {
    const { view, data, indicators } = options;
    this.pager = new OlderHistoryPager({
      isDestroyed: options.isDestroyed,
      isBeforeHistory: () => view.isBeforeHistory(),
      oldestBarTimeSeconds: () => data.bars[0]?.time,
      visibleRange: () => view.visibleRange(),
      prependBars: (candles) => indicators.olderBarsAdded(data.prepend(candles)),
      anchorAfterPrepend: (previous, added) => view.anchorAfterPrepend(previous, added),
      refreshOverlays: options.refreshOverlays,
    });
  }

  get onOlderHistoryNeeded(): ((beforeMs: number) => void) | undefined {
    return this.pager.onNeeded;
  }

  set onOlderHistoryNeeded(callback: ((beforeMs: number) => void) | undefined) {
    this.pager.onNeeded = callback;
  }

  replace(candles: readonly Candle[], replaceOptions: ReplaceHistoryOptions = {}): boolean {
    return this.options.view.traced('replaceHistory', () => this.swap(candles, replaceOptions));
  }

  prefetchOlder(): void {
    this.pager.prefetch();
  }

  appendOlder(candles: readonly Candle[], complete: boolean): void {
    this.pager.append(candles, complete);
  }

  requestIfGapRevealed(): void {
    this.pager.requestIfGapRevealed();
  }

  initialBars(): number {
    const { chart, view } = this.options;
    const scale = chart.timeScale();
    return initialHistoryWindow(scale.width(), scale.options().barSpacing, view.rightMarginBars());
  }

  private swap(candles: readonly Candle[], replaceOptions: ReplaceHistoryOptions): boolean {
    const { chart, view, data, indicators, isDestroyed, discardHeldCandles, barsChanged } = this.options;
    const { timeframe, viewportMode = HistoryViewportMode.Reset } = replaceOptions;
    if (isDestroyed()) {
      return false;
    }
    const previousAnchor = viewportMode === HistoryViewportMode.BarsFromEnd ? view.visibleAnchor() : null;
    const previousSpacing = chart.timeScale().options().barSpacing;
    if (!data.replace(candles, timeframe)) {
      return false;
    }
    // A replaced window is a new history: paging may resume where the last
    // series had already reached its end, and candles held for the old one are stale.
    this.pager.resumePaging();
    discardHeldCandles();
    view.resetFuture();
    view.extendFuture();
    // Carried over in time, never in logical indices: the same index is another
    // moment once the interval or the bar count changes, which is what left the
    // pane empty when a paged series handed its index to a shorter one.
    const preserved = previousAnchor !== null && view.restoreVisibleAnchor(previousAnchor, previousSpacing);
    barsChanged();
    indicators.historyChanged();
    // The carried-over position can sit deeper than this window reaches, which
    // leaves space before the oldest bar. Filling it is a page request, not a
    // nudge of the viewport: the range subscription may not notify for a restored
    // range, so ask here rather than leave the pane looking empty.
    if (preserved) {
      this.pager.requestIfGapRevealed();
    }
    return preserved;
  }
}
