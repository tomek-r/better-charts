import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { BridgeState, Candle, QuoteSnapshot } from '../../../../shared/bridge/types';
import { toRenderBar, type RenderBar } from '../bars/renderBar';
import type { ChartOverlayState } from './buildChartPlugins';
import type { RenderViewport } from './overlayRenderer';
import { createChartSurface } from './chartSurface';
import { TRADING_COLORS } from '../trading/tradingOverlayDrawing';
import { BarCountdownPrimitive } from '../barCountdown/barCountdownPrimitive';
import { CountdownController } from '../barCountdown/countdownController';
import { OhlcLegend } from '../legend/ohlcLegend';
import { ConnectionIndicator } from '../legend/connectionIndicator';
import { PointerReadoutPrimitive } from '../legend/pointerReadoutPrimitive';
import { PriceAxisTagsPrimitive } from '../quotes/priceAxisTagsPrimitive';
import { PriceScaleController } from '../priceScale/priceScaleController';
import { BarSeriesController } from '../bars/barSeriesController';
import { PriceLineController } from '../quotes/priceLineController';
import { isOutsidePane, ViewportController, type DiagnosticViewport } from '../viewport/viewportController';
import type {
  ChartDrawingPaintTarget,
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolHostBase,
  ChartToolResetReason,
} from '../tools/toolContract';
import { ChartToolSet } from '../tools/toolSet';
import { ChartDrawings } from '../drawings/chartDrawings';
import { WorkspacePrimitive } from './workspacePrimitive';
import { installDevTestApi, removeDevTestApi } from './devTestApi';
import { HistoryViewportMode } from '../bars/historyViewportMode';
import { initialHistoryWindow } from '../bars/initialHistoryWindow';
import { OlderHistoryPager } from '../bars/olderHistoryPager';
import { PointerCandleHold } from '../bars/pointerCandleHold';

/** What the app gives the chart for its tools; a tool sees it only through its `ChartToolHost`. */
export type ChartControllerOptions = Pick<ChartToolHost, 'currentMarket' | 'marketDataPort' | 'notifyError'> & {
  toolDefinitions: readonly ChartToolDefinition[];
  /** The tool active at start and made active again after a placement; one of `toolDefinitions`. */
  defaultToolId: string;
};

/** How a whole history replaces the series: for which timeframe, and where the pane goes afterwards. */
interface ReplaceHistoryOptions {
  /** The timeframe the history belongs to; omitted keeps the default one. */
  timeframe?: string;
  viewportMode?: HistoryViewportMode;
}

/**
 * One class owns the chart surface's lifecycle: the handles chartFactory builds,
 * the primitives attached to them, and their disposal. Everything else the chart
 * does is delegated to a collaborator, and the ordering between them is what
 * stays here.
 */
export class ChartController {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly volume: ISeriesApi<'Histogram'>;
  private readonly future: ISeriesApi<'Line'>;
  private readonly priceLines: PriceLineController;
  private readonly primitive: WorkspacePrimitive;
  private readonly observer: ResizeObserver;
  private readonly legend: OhlcLegend;
  private readonly connection: ConnectionIndicator;
  private readonly countdownPrimitive = new BarCountdownPrimitive({ backColor: TRADING_COLORS.sell });
  private readonly scaleControls: PriceScaleController;
  // Every tool shares the pointer's time/price labels, and the tools' above-trading-overlays layer
  // is painted by it just before them. Attached for the chart's life, drawn only while
  // a pointer is over the pane.
  private readonly pointerReadout = new PointerReadoutPrimitive(
    () => this.view.viewport(),
    (target) => this.tools.draw(target),
  );
  // The Bid/Ask lines are native price lines; their tags are price-axis labels
  // positioned by this primitive, because the library's own label alignment
  // restacks them around the last price on every tick (see the chart options).
  private readonly priceTags = new PriceAxisTagsPrimitive({
    askColor: TRADING_COLORS.buy,
    bidColor: TRADING_COLORS.sell,
  });
  // The bar cache, its interval and the price precision are owned by
  // BarSeriesController; the `bars` accessor below is the read-only seam onto it.
  private readonly data: BarSeriesController;
  private readonly countdown: CountdownController;
  private symbol = '';
  private removed = false;
  private readonly liveCandleHold: PointerCandleHold;
  private readonly view: ViewportController;
  private readonly tools: ChartToolSet;
  private readonly olderHistory: OlderHistoryPager;
  /** Selection, user commands and saved records of the chart's drawings. */
  readonly drawings: ChartDrawings;
  onToolRelease?: () => void;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly state: ChartOverlayState,
    options: ChartControllerOptions,
  ) {
    const { chart, candles, volume, future } = createChartSurface(host);
    this.chart = chart;
    this.candles = candles;
    this.volume = volume;
    this.future = future;
    this.data = new BarSeriesController(this.candles, this.volume);
    this.priceLines = new PriceLineController(this.candles, state, this.priceTags);
    this.view = new ViewportController(this.chart, this.candles, this.future, this.data, () => this.removed);
    this.olderHistory = new OlderHistoryPager({
      isDestroyed: () => this.removed,
      isBeforeHistory: () => this.view.isBeforeHistory(),
      oldestBarTimeSeconds: () => this.bars[0]?.time,
      visibleRange: () => this.visibleRange(),
      prependBars: (candles) => this.data.prepend(candles),
      anchorAfterPrepend: (previous, added) => this.view.anchorAfterPrepend(previous, added),
      refreshOverlays: () => this.refreshOverlays(),
    });
    const { toolDefinitions, defaultToolId, ...hostOptions } = options;
    const toolHost: ChartToolHostBase = {
      ...hostOptions,
      barSeries: this.data,
      geometry: this.view,
      requestRepaint: () => this.refreshOverlays(),
      returnToDefaultTool: () => {
        this.tools.returnToDefaultTool();
        this.onToolRelease?.();
      },
    };
    this.tools = new ChartToolSet(toolDefinitions, defaultToolId, toolHost, {
      cursorChanged: (cursor) => {
        this.host.style.cursor = cursor ?? '';
      },
      selectionChanged: (selection) => this.drawings.selectionChanged(selection),
      drawingsChanged: () => this.drawings.drawingsChanged(),
    });
    this.drawings = new ChartDrawings(this.tools, () => this.refreshOverlays());
    this.countdown = new CountdownController(this.countdownPrimitive, {
      symbol: () => this.symbol,
      timeframe: () => this.data.timeframe,
      barTimeSeconds: () => this.data.lastBar()?.time,
      bid: () => this.state.priceLines.bid,
      ask: () => this.state.priceLines.ask,
    });
    this.primitive = new WorkspacePrimitive(this, state);
    this.candles.attachPrimitive(this.primitive);
    // The countdown tag is its own primitive: it paints on the axis canvas and
    // owns the broker-clock timer that repaints it.
    this.candles.attachPrimitive(this.countdownPrimitive);
    this.candles.attachPrimitive(this.priceTags);
    this.candles.attachPrimitive(this.pointerReadout);
    this.legend = new OhlcLegend(host);
    this.connection = new ConnectionIndicator(this.legend.container());
    // The price scale is painted on the library's own canvas, so its toggles
    // (A = auto scale, L = logarithmic) are DOM buttons in the axis column.
    this.scaleControls = new PriceScaleController(host, this.chart, this.candles);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.liveCandleHold = new PointerCandleHold(host, (candle) => this.updateCandle(candle));
    this.resize();
    this.view.onViewportChanged = () => this.olderHistory.requestIfGapRevealed();
    this.view.start();
    // Last of the construction: a tool's `activate` may repaint, which reaches the
    // primitives and controllers built above.
    this.tools.activateDefaultTool();
    if (import.meta.env.DEV) {
      installDevTestApi({
        chart: this.chart,
        bars: () => this.bars,
        visibleRange: () => this.visibleRange(),
        timeToX: (timeMs) => this.timeToX(timeMs),
        toolTestApi: (id) => this.tools.toolTestApi(id),
        drawings: this.drawings,
        pointerReadout: () => this.pointerReadout.readout(),
      });
    }
  }

  /**
   * Set by the session hook: request a page of bars strictly older than this
   * epoch-millisecond boundary. The hook owns the request; the chart only
   * decides that the user revealed a gap worth filling.
   */
  get onOlderHistoryNeeded(): ((beforeMs: number) => void) | undefined {
    return this.olderHistory.onNeeded;
  }

  set onOlderHistoryNeeded(callback: ((beforeMs: number) => void) | undefined) {
    this.olderHistory.onNeeded = callback;
  }

  /**
   * Replaces the whole series. Returns whether a requested viewport was carried
   * over; the caller resets to the default end anchor when it was not, so the
   * pane never keeps a range from a series of a different shape. Timeframe
   * changes can retain the bars-from-end position; other replacements reset.
   */
  replaceHistory(
    candles: readonly Candle[],
    { timeframe, viewportMode = HistoryViewportMode.Reset }: ReplaceHistoryOptions = {},
  ): boolean {
    return this.view.traced('replaceHistory', () => this.swapHistory(candles, timeframe, viewportMode));
  }

  updateCandle(candle: Candle): void {
    if (this.removed) {
      return;
    }
    if (this.liveCandleHold.hold(candle)) {
      return;
    }
    const bar = toRenderBar(candle);
    if (!bar) {
      return;
    }
    const last = this.data.lastBar();
    if (last && bar.time < last.time) {
      return;
    }
    const range = this.visibleRange();
    const follows = this.isFollowing();
    const spacing = this.chart.timeScale().options().barSpacing;
    if (this.data.apply(bar)) {
      this.view.extendFuture();
      if (range) {
        this.view.restoreViewport(range.to + (follows ? 1 : 0), spacing);
      }
    }
    if (!last) {
      this.resetView();
    }
    this.afterBarsChanged();
  }

  resetView(): void {
    if (!this.bars.length || this.removed) {
      return;
    }
    this.view.resetToEnd();
    this.view.clearRetainedPrices();
    // The reset fits the scale to the data it now shows (see `resetToEnd`) but
    // leaves the auto scale option where the user put it: auto scale is off by
    // default, so turning it back on here would light the `A` toggle after every
    // selection change.
    this.scaleControls.sync();
  }

  /** Asks for one older page now; the idle prefetch calls it, the scroll path gates it on a revealed gap. */
  prefetchOlderHistory(): void {
    this.olderHistory.prefetch();
  }

  /** Bars the first history request should ask for, given the pane as measured now. */
  initialHistoryBars(): number {
    const scale = this.chart.timeScale();
    return initialHistoryWindow(scale.width(), scale.options().barSpacing);
  }

  /**
   * Prepends a page of older bars and re-anchors the pane so the visible bars do
   * not move. `complete` is the broker's own end-of-history signal.
   */
  appendOlderHistory(candles: readonly Candle[], complete: boolean): void {
    this.olderHistory.append(candles, complete);
  }

  setSymbol(symbol: string): void {
    if (symbol !== this.symbol) {
      // Another instrument formats its prices differently: let the axis size
      // itself for it instead of carrying the widest label of the previous one.
      this.priceTags.releaseAxisWidth();
    }
    this.symbol = symbol;
    this.updateLegend();
    this.syncCountdown();
  }
  setPricePrecision(digits: number): void {
    if (!this.data.setPrecision(digits)) {
      return;
    }
    this.updateLegend();
  }
  getData(): readonly RenderBar[] {
    return this.bars;
  }
  refreshOverlays(): void {
    if (this.removed) {
      return;
    }
    this.priceLines.sync();
    this.primitive.requestUpdate?.();
  }
  setBidAskPrices(ask?: number, bid?: number): void {
    this.priceLines.setBidAsk(ask, bid);
    this.refreshOverlays();
    this.syncCountdown();
  }
  setQuoteClock(quote?: QuoteSnapshot): void {
    this.countdown.setQuote(quote);
  }
  setCountdownPending(pending: boolean): void {
    this.countdown.setPending(pending);
  }
  visibleRange(): { from: number; to: number } | null {
    return this.view.visibleRange();
  }
  isFollowing(): boolean {
    return this.view.isFollowing();
  }
  diagnosticViewport(): DiagnosticViewport {
    return this.view.diagnosticViewport();
  }
  resize(): void {
    if (this.removed) {
      return;
    }
    const spacing = this.chart.timeScale().options().barSpacing;
    const { width, height } = this.host.getBoundingClientRect();
    // The native resize retains bar spacing and right offset. Forcing a paint
    // updates pane dimensions before extending the helper time series.
    this.chart.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)), true);
    // The crosshair tool rejects pointer positions outside the pane, so its bounds
    // are re-measured here rather than waiting for the next overlay paint.
    this.view.measurePane();
    this.view.ensureFuture(spacing);
    this.refreshOverlays();
  }

  viewport(): RenderViewport {
    return this.view.viewport();
  }

  timeToX(timeMs: number): number {
    return this.view.timeToX(timeMs);
  }
  /** Whether a tool that places drawings (not a pointer tool) is active. */
  isPlacementToolActive(): boolean {
    return this.tools.isPlacementToolActive();
  }
  /**
   * Every pointer shows axis labels (host CSS px), and the active tool hears the move.
   * Outside the pane both hide rather than clamp, because a clamped readout would
   * print a time or price the pointer is not over.
   */
  movePointerReadout(x: number, y: number): void {
    const { width, height } = this.view.paneSize();
    if (isOutsidePane(x, y, width, height)) {
      this.hidePointerReadout();
      return;
    }
    this.pointerReadout.move(x, y);
    this.tools.pointerHover(x, y);
  }
  hidePointerReadout(): void {
    this.pointerReadout.hide();
    this.tools.pointerLeave();
  }
  selectChartTool(toolId: string): void {
    this.tools.selectTool(toolId);
  }
  toolPointerDown(x: number, y: number): boolean {
    return this.tools.pointerDown(x, y);
  }
  toolPointerMove(x: number, y: number): boolean {
    return this.tools.pointerMove(x, y);
  }
  toolPointerUp(outcome: ChartPointerUpOutcome): boolean {
    return this.tools.pointerUp(outcome);
  }
  cancelToolGestures(): void {
    this.tools.cancelGestures();
  }
  drawTools(target: ChartDrawTarget): void {
    this.tools.draw(target);
  }
  /** The drawings stacked under the price bars: the workspace primitive paints them below the series. */
  drawDrawingsBelowBars(target: ChartDrawingPaintTarget): void {
    this.tools.drawBelowBars(target);
  }
  resetTools(reason: ChartToolResetReason): void {
    this.tools.resetTools(reason);
    // The reset removes every drawing from the chart without a save, so only the list readers hear it.
    this.drawings.drawingsReplaced();
  }

  setConnectionStatus(state: BridgeState, message?: string, identity = ''): void {
    this.countdown.setConnection(state, identity);
    this.connection.set(state, message);
    this.syncCountdown();
  }
  destroy(): void {
    if (this.removed) {
      return;
    }
    this.removed = true;
    this.tools.disposeTools();
    this.view.destroy();
    this.observer.disconnect();
    this.liveCandleHold.destroy();
    this.connection.destroy();
    this.legend.destroy();
    this.scaleControls.destroy();
    this.candles.detachPrimitive(this.pointerReadout);
    this.candles.detachPrimitive(this.countdownPrimitive);
    this.candles.detachPrimitive(this.priceTags);
    this.candles.detachPrimitive(this.primitive);
    this.chart.remove();
    if (import.meta.env.DEV) {
      removeDevTestApi();
    }
  }

  private swapHistory(candles: readonly Candle[], timeframe: string | undefined, viewportMode: HistoryViewportMode) {
    if (this.removed) {
      return false;
    }
    const previousAnchor = viewportMode === HistoryViewportMode.BarsFromEnd ? this.view.visibleAnchor() : null;
    const previousSpacing = this.chart.timeScale().options().barSpacing;
    if (!this.data.replace(candles, timeframe)) {
      return false;
    }
    // A replaced window is a new history: paging may resume where the last
    // series had already reached its end, and candles held for the old one are stale.
    this.olderHistory.resumePaging();
    this.liveCandleHold.discard();
    this.view.resetFuture();
    this.view.extendFuture();
    // Carried over in time, never in logical indices: the same index is another
    // moment once the interval or the bar count changes, which is what left the
    // pane empty when a paged series handed its index to a shorter one.
    const preserved = previousAnchor !== null && this.view.restoreVisibleAnchor(previousAnchor, previousSpacing);
    this.afterBarsChanged();
    // The carried-over position can sit deeper than this window reaches, which
    // leaves space before the oldest bar. Filling it is a page request, not a
    // nudge of the viewport: the range subscription may not notify for a restored
    // range, so ask here rather than leave the pane looking empty.
    if (preserved) {
      this.olderHistory.requestIfGapRevealed();
    }
    return preserved;
  }

  /** Brings everything that reads the bars up to date after they changed. */
  private afterBarsChanged(): void {
    this.updateLegend();
    this.refreshOverlays();
    this.syncCountdown();
    this.tools.barsChanged();
  }

  /** Read-only seam onto the bar cache, which BarSeriesController owns and writes. */
  private get bars(): readonly RenderBar[] {
    return this.data.bars;
  }

  /**
   * The countdown primitive owns the broker clock, the broker-second alignment
   * and the axis label; CountdownController mirrors the controller's single copy
   * of each input into it, so every input has one owner. Call this whenever one of
   * those inputs changes: quotes, bars, timeframe, Bid, symbol or connection.
   */
  private syncCountdown(): void {
    this.countdown.sync();
  }

  private updateLegend(): void {
    this.legend.apply(this.symbol, this.data.lastBar(), this.data.pricePrecision);
  }
}
