import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { BridgeState, Candle, QuoteSnapshot } from '../../../shared/bridge/types';
import { toRenderBar, type RenderBar } from './mt5DataAdapter';
import type { ChartOverlayState } from './overlays';
import type { RenderViewport } from './overlayTypes';
import type { DrawingTool } from '../../tools/toolTypes';
import { createChartSurface } from './chartFactory';
import { TRADING_COLORS } from './tradingOverlayDrawing';
import { BarCountdownPrimitive, CountdownController } from './barCountdown';
import { OhlcLegend } from './ohlcLegend';
import { ConnectionIndicator } from './connectionIndicator';
import { CrosshairPrimitive } from './crosshairPrimitive';
import { PriceAxisTagsPrimitive } from './priceAxisTagsPrimitive';
import { PriceScaleController } from './priceScaleController';
import { BarSeriesController } from './barSeriesController';
import { PriceLineController } from './priceLineController';
import { isOutsidePane, ViewportController } from './viewportController';
import { FixedRangeProfileController, type ProfileRange } from './fixedRangeProfileController';
import { WorkspacePrimitive } from './workspacePrimitive';
import { installDevTestApi, removeDevTestApi } from './devTestApi';

/**
 * Re-exported because it names a parameter of this class's public callbacks; the
 * type itself belongs to the profile tool, which is where it is defined.
 */
export type { ProfileRange };

export enum HistoryViewportMode {
  Reset = 'reset',
  BarsFromEnd = 'bars-from-end',
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
  // Every tool shares pointer labels; Cross additionally draws the lines.
  // Attached for the chart's life, drawn only while a pointer is over the pane.
  private readonly crosshair = new CrosshairPrimitive();
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
  private tool: DrawingTool = null;
  private removed = false;
  private readonly view: ViewportController;
  private readonly profile: FixedRangeProfileController;
  // Set once the broker's page came back short, or a page held nothing older
  // than the cache. Cleared by a new window, which is a new history.
  private olderHistoryExhausted = false;
  onProfileCommit?: (range: ProfileRange) => void;
  onProfileDelete?: () => void;
  onToolRelease?: () => void;
  /**
   * Set by the session hook: request a page of bars strictly older than this
   * epoch-millisecond boundary. The hook owns the request; the chart only
   * decides that the user revealed a gap worth filling.
   */
  onOlderHistoryNeeded?: (beforeMs: number) => void;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly state: ChartOverlayState,
  ) {
    const { chart, candles, volume, future } = createChartSurface(host);
    this.chart = chart;
    this.candles = candles;
    this.volume = volume;
    this.future = future;
    this.data = new BarSeriesController(this.candles, this.volume);
    this.priceLines = new PriceLineController(this.candles, state, this.priceTags);
    this.view = new ViewportController(this.chart, this.candles, this.future, this.data, () => this.removed);
    this.profile = new FixedRangeProfileController({
      data: this.data,
      geometry: this.view,
      state: this.state.fixedRangeProfile,
      isToolActive: () => this.tool === 'fixedRangeProfile',
      requestRepaint: () => this.refreshOverlays(),
      onCommit: (range) => this.onProfileCommit?.(range),
      onToolRelease: () => {
        this.tool = null;
        this.host.style.cursor = '';
        this.onToolRelease?.();
      },
      onDelete: () => this.onProfileDelete?.(),
    });
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
    this.candles.attachPrimitive(this.crosshair);
    this.legend = new OhlcLegend(host);
    this.connection = new ConnectionIndicator(this.legend.container());
    // The price scale is painted on the library's own canvas, so its toggles
    // (A = auto scale, L = logarithmic) are DOM buttons in the axis column.
    this.scaleControls = new PriceScaleController(host, this.chart, this.candles);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.view.onViewportChanged = () => this.requestOlderHistory();
    this.view.start();
    if (import.meta.env.DEV) {
      installDevTestApi({
        data: () => this.bars.map((bar) => ({ ...bar })),
        visibleRange: () => this.visibleRange(),
        scrollToRange: (range) => this.chart.timeScale().setVisibleLogicalRange(range),
        timeToX: (timeMs) => this.timeToX(timeMs),
        profileBoundaries: () => this.profileBoundaries(),
        crosshair: () => this.crosshair.readout(),
        priceScale: () => {
          const scale = this.chart.priceScale('right');
          const options = scale.options();
          return {
            autoScale: options.autoScale,
            mode: options.mode,
            axisWidth: scale.width(),
            paneHeight: this.chart.panes()[0]?.getHeight() ?? 0,
            timeAxisHeight: this.chart.timeScale().height(),
            range: scale.getVisibleRange(),
          };
        },
      });
    }
  }

  /**
   * Replaces the whole series. Returns whether a requested viewport was carried
   * over; the caller resets to the default end anchor when it was not, so the
   * pane never keeps a range from a series of a different shape. Timeframe
   * changes can retain the bars-from-end position; other replacements reset.
   */
  replaceHistory(candles: readonly Candle[], timeframe?: string, viewportMode = HistoryViewportMode.Reset): boolean {
    if (this.removed) {
      return false;
    }
    const previousAnchor = viewportMode === HistoryViewportMode.BarsFromEnd ? this.view.visibleAnchor() : null;
    const previousSpacing = this.chart.timeScale().options().barSpacing;
    if (!this.data.replace(candles, timeframe)) {
      return false;
    }
    // A replaced window is a new history: paging may resume where the last
    // series had already reached its end.
    this.olderHistoryExhausted = false;
    this.view.resetFuture();
    this.view.extendFuture();
    // Carried over in time, never in logical indices: the same index is another
    // moment once the interval or the bar count changes, which is what left the
    // pane empty when a paged series handed its index to a shorter one.
    const preserved = previousAnchor !== null && this.view.restoreVisibleAnchor(previousAnchor, previousSpacing);
    this.updateLegend();
    this.refreshOverlays();
    this.syncCountdown();
    // The carried-over position can sit deeper than this window reaches, which
    // leaves space before the oldest bar. Filling it is a page request, not a
    // nudge of the viewport: the range subscription may not fire for a restored
    // range, so ask here rather than leave the pane looking empty.
    if (preserved) {
      this.requestOlderHistory();
    }
    return preserved;
  }

  updateCandle(candle: Candle): void {
    if (this.removed) {
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
    this.updateLegend();
    this.refreshOverlays();
    this.syncCountdown();
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

  /**
   * Asks for a page of older bars once the pane shows empty space before the
   * oldest bar. Exhaustion is latched here because it is a property of the
   * loaded history, not of the request in flight.
   */
  private requestOlderHistory(): void {
    if (this.removed || this.olderHistoryExhausted) {
      return;
    }
    const oldest = this.bars[0];
    if (!oldest || !this.view.isBeforeHistory()) {
      return;
    }
    this.onOlderHistoryNeeded?.(oldest.time * 1000);
  }

  /**
   * Prepends a page of older bars and re-anchors the pane so the visible bars do
   * not move. `complete` is the broker's own end-of-history signal.
   */
  appendOlderHistory(candles: readonly Candle[], complete: boolean): void {
    if (this.removed) {
      return;
    }
    const previous = this.visibleRange();
    const added = this.data.prepend(candles);
    if (added > 0) {
      this.view.anchorAfterPrepend(previous, added);
      this.refreshOverlays();
    }
    // A short page ends this history, and so does a page that held nothing
    // older — which is also how a peer that ignored the anchor answers.
    if (!complete || added === 0) {
      this.olderHistoryExhausted = true;
    }
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
  /** Read-only seam onto the bar cache, which BarSeriesController owns and writes. */
  private get bars(): readonly RenderBar[] {
    return this.data.bars;
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

  /**
   * The countdown primitive owns the broker clock, the broker-second alignment
   * and the axis label; CountdownController mirrors the controller's single copy
   * of each input into it, so every input has one owner. Call this whenever one of
   * those inputs changes: quotes, bars, timeframe, Bid, symbol or connection.
   */
  private syncCountdown(): void {
    this.countdown.sync();
  }
  visibleRange(): { from: number; to: number } | null {
    return this.view.visibleRange();
  }
  isFollowing(): boolean {
    return this.view.isFollowing();
  }
  diagnosticViewport() {
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
    // The Cross tool rejects pointer positions outside the pane, so its bounds
    // are re-measured here rather than waiting for the next overlay paint.
    this.view.measurePane();
    this.view.ensureFuture(width, spacing);
    this.refreshOverlays();
  }

  viewport(): RenderViewport {
    return this.view.viewport();
  }

  timeToX(timeMs: number): number {
    return this.view.timeToX(timeMs);
  }
  isProfileToolActive(): boolean {
    return this.tool === 'fixedRangeProfile';
  }
  /**
   * Every pointer shows axis labels (host CSS px). Outside the pane the
   * readout hides rather than clamping, because a clamped readout would
   * print a time or price the pointer is not over.
   */
  moveCrosshair(x: number, y: number): void {
    const { width, height } = this.view.paneSize();
    if (isOutsidePane(x, y, width, height)) {
      this.crosshair.hide();
      return;
    }
    this.crosshair.move(x, y);
  }
  hideCrosshair(): void {
    this.crosshair.hide();
  }
  setDrawingTool(tool: DrawingTool): void {
    const hasGesture = this.profile.hasGesture();
    if (tool === this.tool && !hasGesture) {
      return;
    }
    if (hasGesture) {
      this.profile.cancelGesture();
    }
    this.tool = tool;
    this.crosshair.setLinesVisible(tool === 'crosshair');
    this.host.style.cursor = tool ? 'crosshair' : '';
  }
  getProfileRange(): ProfileRange | null {
    return this.profile.getRange();
  }
  profileBoundaries() {
    return this.profile.boundaries();
  }
  profilePointerDown(x: number, y: number): boolean {
    return this.profile.pointerDown(x, y);
  }
  profilePointerMove(x: number): boolean {
    return this.profile.pointerMove(x);
  }
  profilePointerUp(commit: boolean): boolean {
    return this.profile.pointerUp(commit);
  }
  cancelProfileGesture(): void {
    this.profile.cancelGesture();
  }
  clearProfileSelection(): void {
    this.profile.clearSelection();
  }
  deleteProfile(): void {
    this.profile.deleteProfile();
  }
  drawSelection(ctx: CanvasRenderingContext2D): void {
    this.profile.drawSelection(ctx);
  }
  private updateLegend(): void {
    const format = this.candles.options().priceFormat;
    const digits = format.type === 'price' ? format.precision : 2;
    this.legend.apply(this.symbol, this.data.lastBar(), digits);
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
    this.view.destroy();
    this.observer.disconnect();
    this.connection.destroy();
    this.legend.destroy();
    this.scaleControls.destroy();
    this.candles.detachPrimitive(this.crosshair);
    this.candles.detachPrimitive(this.countdownPrimitive);
    this.candles.detachPrimitive(this.priceTags);
    this.candles.detachPrimitive(this.primitive);
    this.chart.remove();
    if (import.meta.env.DEV) {
      removeDevTestApi();
    }
  }
}
