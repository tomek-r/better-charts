import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { BridgeState, Candle, QuoteSnapshot } from '../../../../shared/bridge/types';
import type { RenderBar } from '../bars/renderBar';
import type { ChartOverlayState } from './buildChartPlugins';
import type { RenderViewport } from './overlayRenderer';
import { createChartSurface } from './chartSurface';
import { ChartPointer } from './chartPointer';
import type { ChartAppearance, ChartSizedLineAppearance } from './chartAppearance';
import type { ChartScalesAppearance, ChartScalesState } from './chartScalesAppearance';
import { ChartScalesPresenter } from './chartScalesPresenter';
import { ChartAppearanceController } from './chartAppearanceController';
import { BrokerTime } from '../brokerTime/brokerTime';
import { ChartTimeZoneDisplay } from '../brokerTime/chartTimeZoneDisplay';
import { BarCountdownPrimitive } from '../barCountdown/barCountdownPrimitive';
import { CountdownController } from '../barCountdown/countdownController';
import { chartStatusLine, type ChartStatusLine } from '../legend/chartStatusLine';
import { OhlcReadout } from '../legend/ohlcReadout';
import { MarketStatusIndicator } from '../legend/marketStatusIndicator';
import type { MarketStatus } from '../legend/marketStatus';
import { PriceAxisTagsPrimitive } from '../quotes/priceAxisTagsPrimitive';
import { PriceScaleController, type PriceScaleState } from '../priceScale/priceScaleController';
import { BarSeriesController } from '../bars/barSeriesController';
import type { BarStyleAppearance } from '../barStyle/barStyleAppearance';
import { PriceLineController } from '../quotes/priceLineController';
import { ViewportController, type DiagnosticViewport } from '../viewport/viewportController';
import type {
  ChartDrawingPaintTarget,
  ChartDrawTarget,
  ChartToolHostBase,
  ChartToolResetReason,
} from '../tools/toolContract';
import { ChartToolSet, type ChartToolInput } from '../tools/toolSet';
import { ChartDrawings } from '../drawings/chartDrawings';
import { WorkspacePrimitive } from './workspacePrimitive';
import { installChartDevTestApi, removeDevTestApi } from './devTestApi';
import type { ChartControllerOptions } from './chartControllerOptions';
import { ChartHistory, type ReplaceHistoryOptions } from './chartHistory';
import { createChartIndicators } from './chartIndicatorWiring';
import type { IndicatorLayer } from '../indicators/indicatorLayer';
import type { IndicatorRuntime } from '../indicators/indicatorRuntime';
import { ChartIndicators } from '../indicators/chartIndicators';
import { IndicatorSelection } from '../indicators/indicatorSelection';
import type { IndicatorLegendCommands } from '../legend/indicatorLegend';
import { LiveBarController } from './liveBarController';
import { resetPaneToEnd, sizeChartToHost } from './chartPaneView';
import { PointerCandleHold } from '../bars/pointerCandleHold';

/**
 * One class owns the chart surface's lifecycle: the handles chartFactory builds,
 * the primitives attached to them, and their disposal. Everything else the chart
 * does is delegated to a collaborator, and the ordering between them is what
 * stays here.
 */
export class ChartController {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly priceLines: PriceLineController;
  private readonly primitive: WorkspacePrimitive;
  private readonly observer: ResizeObserver;
  private readonly ohlcReadout: OhlcReadout;
  private readonly marketStatus: MarketStatusIndicator;
  // Broker time from the live ticks; the countdown and the time zone clock both read it.
  private readonly brokerTime = new BrokerTime();
  private readonly countdownPrimitive = new BarCountdownPrimitive(this.brokerTime);
  private readonly scaleControls: PriceScaleController;
  private readonly scales: ChartScalesPresenter;
  // Every tool shares the pointer's time/price labels, and the tools' above-trading-overlays layer
  // is painted by it just before them. Its labels are attached for the chart's life, drawn only while
  // a pointer is over the pane.
  private readonly pointer: ChartPointer;
  // The Bid/Ask lines are native price lines; their tags are price-axis labels
  // positioned by this primitive, because the library's own label alignment
  // restacks them around the last price on every tick (see the chart options).
  private readonly priceTags = new PriceAxisTagsPrimitive();
  // The bar cache, its interval and the price precision are owned by
  // BarSeriesController; the `bars` accessor below is the read-only seam onto it.
  private readonly data: BarSeriesController;
  private readonly countdown: CountdownController;
  private symbol = '';
  private removed = false;
  private readonly appearance: ChartAppearanceController;
  private readonly timeZoneDisplay: ChartTimeZoneDisplay;
  private readonly liveCandleHold: PointerCandleHold;
  private readonly liveBar: LiveBarController;
  private readonly view: ViewportController;
  private readonly tools: ChartToolSet;
  /** Pointer and selection commands for the active tool; the same tool set, narrowed to what input routing needs. */
  readonly toolInput: ChartToolInput;
  private readonly history: ChartHistory;
  /** Selection, user commands and saved records of the chart's drawings. */
  readonly drawings: ChartDrawings;
  /** The indicator the user has selected, if any: the chart selects one object at a time. */
  readonly indicatorSelection: IndicatorSelection;
  /** The indicators drawn on the price pane, each from the frames its producer hands over. */
  readonly indicatorLayer: IndicatorLayer;
  /** The indicators attached to the chart: each loads on a new history and follows the live bar. */
  readonly indicators: IndicatorRuntime;
  /** The layer, the runtime and the legend above, owned and torn down as one unit. */
  private readonly chartIndicators: ChartIndicators;
  onToolRelease?: () => void;

  /** The app's commands for the legend's row buttons; null while none is mounted. */
  setIndicatorCommands(commands: IndicatorLegendCommands | null): void {
    this.chartIndicators.setCommands(commands);
  }

  constructor(
    private readonly host: HTMLDivElement,
    private readonly state: ChartOverlayState,
    options: ChartControllerOptions,
  ) {
    const { chart, candles, future } = createChartSurface(host);
    this.chart = chart;
    this.candles = candles;
    // The view and the tool set are built further down, so the pointer asks them only when it paints.
    this.pointer = new ChartPointer(
      host,
      () => this.view,
      () => this.tools,
    );
    this.timeZoneDisplay = new ChartTimeZoneDisplay(this.chart, this.pointer.labels, this.brokerTime);
    this.data = new BarSeriesController(this.candles, this.chart);
    // The drawings are built further down, so the selection reaches them when it clears them, not before.
    const indicatorWiring = createChartIndicators(this.chart, host, this.data, this.candles, options, {
      clearDrawingSelection: () => this.drawings.clearSelection(),
      drawingSelected: () => this.drawings.selected() !== null,
      plotHoverChanged: (overPlot) => this.pointer.setOverPlot(overPlot),
    });
    const { toolDefinitions, defaultToolId, toolHost: toolHostOptions } = indicatorWiring;
    this.indicatorSelection = indicatorWiring.selection;
    this.chartIndicators = indicatorWiring.indicators;
    this.indicatorLayer = this.chartIndicators.layer;
    this.indicators = this.chartIndicators.runtime;
    this.priceLines = new PriceLineController(this.candles, state, this.priceTags);
    this.view = new ViewportController(this.chart, this.candles, future, this.data, () => this.removed);
    this.history = new ChartHistory({
      chart: this.chart,
      view: this.view,
      data: this.data,
      indicators: this.indicators,
      isDestroyed: () => this.removed,
      discardHeldCandles: () => this.liveCandleHold.discard(),
      barsChanged: () => this.afterBarsChanged(),
      olderBarsAdded: () => {
        this.ohlcReadout.refresh();
        this.refreshOverlays();
      },
    });
    const toolHost: ChartToolHostBase = {
      ...toolHostOptions,
      barSeries: this.data,
      geometry: this.view,
      requestRepaint: () => this.refreshOverlays(),
      crosshairStyle: () => this.crosshairStyle(),
      returnToDefaultTool: () => {
        this.tools.returnToDefaultTool();
        this.onToolRelease?.();
      },
    };
    this.tools = new ChartToolSet(toolDefinitions, defaultToolId, toolHost, {
      cursorChanged: (toolCursor) => this.pointer.setToolCursor(toolCursor),
      selectionChanged: (selection) => {
        this.drawings.selectionChanged(selection);
        this.indicatorSelection.drawingSelected(selection);
      },
      drawingsChanged: () => this.drawings.drawingsChanged(),
    });
    this.toolInput = this.tools;
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
    // owns the timer that repaints it. The broker time it counts on is the
    // controller's, because the time zone clock reads it too.
    this.candles.attachPrimitive(this.countdownPrimitive);
    this.candles.attachPrimitive(this.priceTags);
    this.candles.attachPrimitive(this.pointer.labels);
    this.ohlcReadout = new OhlcReadout(host, this.data, this.chartIndicators.hoveredBar, () => this.symbol);
    this.marketStatus = new MarketStatusIndicator(this.ohlcReadout.container());
    // The price scale is painted on the library's own canvas, so its toggles
    // (A = auto scale, L = the price scale mode) are DOM buttons in the axis column, as
    // is the gear in its corner; the gear asks for the settings with an event.
    this.scaleControls = new PriceScaleController(host, this.chart, this.candles);
    this.scales = new ChartScalesPresenter({
      priceScale: this.scaleControls,
      countdown: this.countdown,
      quotes: this.priceLines,
      tags: this.priceTags,
      timeLabels: this.timeZoneDisplay,
      isDisposed: () => this.removed,
    });
    this.appearance = new ChartAppearanceController(this.chart, this.view, this.scaleControls);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.liveCandleHold = new PointerCandleHold(host, (candle) => this.updateCandle(candle));
    this.liveBar = new LiveBarController(this.chart, this.data, this.view, this.liveCandleHold, {
      isDisposed: () => this.removed,
      resetView: () => this.resetView(),
      barsChanged: () => {
        this.afterBarsChanged();
        this.indicators.liveBarChanged();
      },
    });
    this.resize();
    this.view.onViewportChanged = () => this.history.requestIfGapRevealed();
    this.view.start();
    // Last of the construction: a tool's `activate` may repaint, which reaches the
    // primitives and controllers built above.
    this.tools.activateDefaultTool();
    if (import.meta.env.DEV) {
      installChartDevTestApi(this.chart, this.candles, this.tools, this.pointer.labels, this.view, this, this.data);
    }
  }

  /**
   * Set by the session hook: request a page of bars strictly older than this epoch-millisecond boundary.
   * The hook owns the request; the chart only decides that the user revealed a gap worth filling.
   */
  get onOlderHistoryNeeded(): ((beforeMs: number) => void) | undefined {
    return this.history.onOlderHistoryNeeded;
  }

  set onOlderHistoryNeeded(callback: ((beforeMs: number) => void) | undefined) {
    this.history.onOlderHistoryNeeded = callback;
  }

  /**
   * Replaces the whole series. Returns whether a requested viewport was carried
   * over; the caller resets to the default end anchor when it was not, so the
   * pane never keeps a range from a series of a different shape. Timeframe
   * changes can retain the bars-from-end position; other replacements reset.
   */
  replaceHistory(candles: readonly Candle[], options: ReplaceHistoryOptions = {}): boolean {
    return this.history.replace(candles, options);
  }

  updateCandle(candle: Candle): void {
    this.liveBar.apply(candle);
  }

  resetView(): void {
    if (!this.bars.length || this.removed) {
      return;
    }
    resetPaneToEnd(this.view, this.scaleControls);
  }

  /**
   * The chart menu's Reset chart view: the pane back to the end anchor with the default zoom, and every
   * price scale back to fitting the bars it shows by itself, which is the view a chart opens on.
   */
  resetChartView(): void {
    this.scales.fitAllPanes();
    this.resetView();
  }

  /** Asks for one older page now; the idle prefetch calls it, the scroll path gates it on a revealed gap. */
  prefetchOlderHistory(): void {
    this.history.prefetchOlder();
  }

  /** Bars the first history request should ask for, given the pane as measured now. */
  initialHistoryBars(): number {
    return this.history.initialBars();
  }

  /**
   * Prepends a page of older bars and re-anchors the pane so the visible bars do
   * not move. `complete` is the broker's own end-of-history signal.
   */
  appendOlderHistory(candles: readonly Candle[], complete: boolean): void {
    this.history.appendOlder(candles, complete);
  }

  setSymbol(symbol: string): void {
    if (symbol !== this.symbol) {
      this.scales.changeSymbolTag(symbol);
    }
    this.symbol = symbol;
    this.ohlcReadout.refresh();
    this.scales.syncCountdown();
  }
  setPricePrecision(digits: number): void {
    if (!this.data.setPrecision(digits)) {
      return;
    }
    this.ohlcReadout.refresh();
  }
  /** Shows every bar in `zone`'s wall clock; broker time until the broker offset is known. */
  setTimeZone(zone: string, brokerUtcOffsetMinutes: number | null): void {
    this.timeZoneDisplay.apply(zone, brokerUtcOffsetMinutes);
  }
  /** Draws the chart's bar style: the candles on the anchor, or a series of its own for every other style. */
  setBarStyle(appearance: BarStyleAppearance): void {
    if (this.removed) {
      return;
    }
    this.data.setBarStyle(appearance);
    this.ohlcReadout.refresh();
    this.refreshOverlays();
  }
  /**
   * Hides the price bars from the chart, or shows them again, as the object tree's bars row asks: the
   * candles, or the series that draws another bar style, stop painting while the drawings and the
   * indicators keep drawing.
   */
  setPriceBarsHidden(hidden: boolean): void {
    if (this.removed) {
      return;
    }
    this.data.setBarsHidden(hidden);
  }
  /**
   * Paints the chart itself with the Canvas tab's settings: background, both grids, scale text and
   * lines, price margins and the empty bars to the right of the last one.
   */
  setChartAppearance(appearance: ChartAppearance): void {
    if (this.removed) {
      return;
    }
    if (this.appearance.apply(appearance)) {
      this.refreshOverlays();
    }
  }
  /**
   * Applies the chart's scales and lines: how the A/L row reaches the screen, the price scale's shape
   * and its symbol tag, whether the countdown tag is drawn, what the Bid/Ask quote draws of itself, and
   * how the axis, the pointer and the footer write time.
   */
  setScalesAppearance(appearance: ChartScalesAppearance): void {
    this.scales.applyAppearance(appearance);
  }
  /** What the chart draws of its scales and lines, read back from the collaborators that own each part. */
  scalesState(): ChartScalesState {
    return this.scales.drawnState();
  }
  /** The OHLC line and the indicator rows that the settings dialog's Status line tab controls. */
  statusLine(): ChartStatusLine {
    return chartStatusLine(this.ohlcReadout, this.chartIndicators);
  }
  /** The price scale as it is drawn now: whether it fits the data itself, its spacing and its direction. */
  priceScaleState(): PriceScaleState {
    return this.scales.priceScaleState();
  }
  /** Fits the price scale to the data it shows, or stops it doing so. */
  setAutoScale(on: boolean): void {
    this.scales.setAutoScale(on);
  }
  /** The colour, dash and thickness of the pointer's crosshair lines, which every tool draws the pointer with. */
  crosshairStyle(): ChartSizedLineAppearance {
    return this.appearance.crosshairStyle();
  }
  /** UTC now as the broker's ticks tell it; the desktop clock until a live tick and the broker's offset are known. */
  clockNowMs(): number {
    return this.timeZoneDisplay.clockNowMs();
  }
  getData(): readonly RenderBar[] {
    return this.bars;
  }
  refreshOverlays(): void {
    if (this.removed) {
      return;
    }
    this.scales.resyncAxis();
    this.primitive.requestUpdate?.();
  }
  setBidAskPrices(ask?: number, bid?: number): void {
    this.priceLines.setBidAsk(ask, bid);
    this.refreshOverlays();
    this.scales.syncCountdown();
  }
  setQuoteClock(quote?: QuoteSnapshot): void {
    if (quote) {
      this.brokerTime.acceptQuote(quote);
    }
    this.scales.syncCountdown();
  }
  setCountdownPending(pending: boolean): void {
    this.countdown.setPending(pending);
  }
  visibleRange(): { from: number; to: number } | null {
    return this.view.visibleRange();
  }
  diagnosticViewport(): DiagnosticViewport {
    return this.view.diagnosticViewport();
  }
  resize(): void {
    if (this.removed) {
      return;
    }
    sizeChartToHost(this.chart, this.host, this.view);
    this.refreshOverlays();
  }

  viewport(): RenderViewport {
    return this.view.viewport();
  }

  timeToX(timeMs: number): number {
    return this.view.timeToX(timeMs);
  }
  /** Every pointer shows axis labels (host CSS px), and the active tool hears the move. */
  movePointerReadout(x: number, y: number): void {
    this.pointer.move(x, y);
  }
  hidePointerReadout(): void {
    this.pointer.hide();
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

  /** Whether the shown symbol's market is open, as the legend's dot reports it. */
  setMarketStatus(status: MarketStatus, label: string): void {
    this.marketStatus.set(status, label);
  }

  setConnectionStatus(state: BridgeState, identity = ''): void {
    this.brokerTime.setConnection(state, identity);
    this.countdown.setConnection(state);
    this.scales.syncCountdown();
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
    this.marketStatus.destroy();
    this.ohlcReadout.destroy();
    this.scaleControls.destroy();
    this.candles.detachPrimitive(this.pointer.labels);
    this.candles.detachPrimitive(this.countdownPrimitive);
    this.candles.detachPrimitive(this.priceTags);
    this.candles.detachPrimitive(this.primitive);
    this.chartIndicators.destroy();
    this.data.destroy();
    this.chart.remove();
    if (import.meta.env.DEV) {
      removeDevTestApi();
    }
  }

  /** Brings everything that reads the bars up to date after they changed. */
  private afterBarsChanged(): void {
    this.timeZoneDisplay.applyInterval(this.data.timeframe);
    this.ohlcReadout.refresh();
    this.refreshOverlays();
    this.scales.syncCountdown();
    this.tools.barsChanged();
  }

  /** Read-only seam onto the bar cache, which BarSeriesController owns and writes. */
  private get bars(): readonly RenderBar[] {
    return this.data.bars;
  }
}
