import {
  ColorType,
  type Background,
  type CandlestickData,
  type GridLineOptions,
  type IChartApi,
  type ISeriesApi,
  type LineStyle,
  type PriceScaleMode,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import type { ChartDrawings } from '../drawings/chartDrawings';
import type { ChartDrawingRecord, ChartDrawingSelection } from '../drawings/drawingRecord';
import type { RenderBar } from '../bars/renderBar';
import { candleSeriesColors, type CandlePointColors } from '../bars/candleAppearance';
import type { PointerReadout } from '../legend/pointerReadoutPrimitive';
import type { ChartSizedLineAppearance } from './chartAppearance';
import type { ChartScalesState } from './chartScalesAppearance';
import { clearViewportChangeLog, viewportChangeLog, type ViewportChangeRecord } from '../viewport/viewportDiagnostics';

/** One candle's time with the colours it overrides the series with, as a plain copy. */
export interface CandlePointState extends CandlePointColors {
  readonly time: number;
}

/** One candle series as the test hook shows it: its colour options and its points' colours. */
export interface CandleSeriesState {
  readonly colors: ReturnType<typeof candleSeriesColors>;
  readonly points: CandlePointState[];
}

/** The chart's background as the library reports it: one colour, or the two ends of a gradient. */
export interface ChartBackgroundState {
  readonly type: ColorType;
  readonly color?: string;
  readonly topColor?: string;
  readonly bottomColor?: string;
}

/** One of the chart's grid lines, as the library holds it. */
export interface ChartGridLineState {
  readonly visible: boolean;
  readonly color: string;
  readonly style: LineStyle;
}

/** What the Canvas tab sets, read back from the chart options and the controllers that own the rest. */
export interface ChartAppearanceState {
  readonly layout: {
    readonly background: ChartBackgroundState;
    readonly textColor: string;
    readonly fontSize: number;
  };
  readonly grid: {
    readonly vertLines: ChartGridLineState;
    readonly horzLines: ChartGridLineState;
  };
  readonly rightPriceScaleBorder: string;
  readonly timeScaleBorder: string;
  readonly scaleMargins: { readonly top: number; readonly bottom: number };
  readonly rightMarginBars: number;
  readonly crosshair: ChartSizedLineAppearance;
}

/**
 * The development-only test hook the e2e suite drives (see e2e/README.md).
 *
 * Every member is an arrow accessor rather than a method reference, so each call
 * reads live chart state, and every value it returns is a primitive, a plain
 * copy or a chart-library scalar — never a chart-library object.
 *
 * `import.meta.env.DEV` gates the install at its call site in ChartController, so
 * a production bundle contains none of this. `tool(id)` hands back the tool's own
 * `testApi()`, so a tool's test surface lives with the tool, not here.
 */
export interface DevTestApi {
  data(): readonly RenderBar[];
  /** The anchor candle series' colours and per-point colours, as plain copies. */
  candles(): CandleSeriesState;
  visibleRange(): { from: number; to: number } | null;
  scrollToRange(range: { from: number; to: number }): void;
  /** Every recent write to the time scale with the view before and after it, oldest first. */
  viewportChanges(): ViewportChangeRecord[];
  clearViewportChanges(): void;
  timeToX(timeMs: number): number;
  tool(id: string): unknown;
  /** Every drawing the tools hold, in registry order, each stamped with its tool id. */
  drawings(): ChartDrawingRecord[];
  /** The drawing the user has selected and whether it is locked; null when none. */
  selectedDrawing(): ChartDrawingSelection | null;
  /** The pointer's time/price labels, shown for every tool; null while no pointer is over the pane. */
  pointerReadout(): PointerReadout | null;
  /** What the Canvas tab sets: the chart's own paint, its margins and the crosshair. */
  appearance(): ChartAppearanceState;
  /** What the Scales and lines tab sets: the A/L row, the countdown tag, the quote and the time labels. */
  scales(): ChartScalesState;
  priceScale(): {
    autoScale: boolean;
    mode: PriceScaleMode;
    axisWidth: number;
    paneHeight: number;
    timeAxisHeight: number;
    range: { from: number; to: number } | null;
  };
}

type DevWindow = { __chartTest?: DevTestApi; __viewportLog?: () => void };

function describeChange({ caller, atMs, before, after }: ViewportChangeRecord) {
  const edge = (range: ViewportChangeRecord['before']['range']) => (range ? `${range.from}..${range.to}` : 'none');
  return {
    caller,
    time: new Date(atMs).toISOString(),
    before: edge(before.range),
    after: edge(after.range),
    bars: after.barCount,
    helperPoints: after.futureCount,
    barSpacing: after.barSpacing,
    following: `${before.following} -> ${after.following}`,
  };
}

/** The colour options of a candle series, copied out of the library's own options object. */
function candleColorsOf(candles: ISeriesApi<'Candlestick'>): ReturnType<typeof candleSeriesColors> {
  const options = candles.options();
  return {
    upColor: options.upColor,
    downColor: options.downColor,
    borderVisible: options.borderVisible,
    borderUpColor: options.borderUpColor,
    borderDownColor: options.borderDownColor,
    wickVisible: options.wickVisible,
    wickUpColor: options.wickUpColor,
    wickDownColor: options.wickDownColor,
  };
}

/** The seconds of a point's time; the candle series only ever holds `UTCTimestamp` values. */
function pointTimeSeconds(time: Time): number {
  return typeof time === 'number' ? time : Number.NaN;
}

/** Whitespace points carry a time only, so a close marks a real candle. */
function isCandlestickPoint(point: CandlestickData<Time> | WhitespaceData<Time>): point is CandlestickData<Time> {
  return 'close' in point;
}

function candlePointState(point: CandlestickData<Time>): CandlePointState {
  return {
    time: pointTimeSeconds(point.time),
    color: point.color,
    borderColor: point.borderColor,
    wickColor: point.wickColor,
  };
}

/** The candle series' colours and per-point colours, read back from the series itself. */
export function readCandleSeriesState(candles: ISeriesApi<'Candlestick'>): CandleSeriesState {
  return { colors: candleColorsOf(candles), points: candles.data().filter(isCandlestickPoint).map(candlePointState) };
}

/** The live chart state the test hook reads; the controller supplies accessors, never chart-library objects. */
export interface DevTestApiSources {
  chart: IChartApi;
  bars(): readonly RenderBar[];
  candles(): CandleSeriesState;
  visibleRange(): { from: number; to: number } | null;
  timeToX(timeMs: number): number;
  toolTestApi(id: string): unknown;
  drawings: ChartDrawings;
  pointerReadout(): PointerReadout | null;
  rightMarginBars(): number;
  crosshairStyle(): ChartSizedLineAppearance;
  scalesState(): ChartScalesState;
}

/** The live readings the surface already publishes; the hook reads them through these. */
export interface DevTestReadings {
  readonly drawings: ChartDrawings;
  getData(): readonly RenderBar[];
  visibleRange(): { from: number; to: number } | null;
  timeToX(timeMs: number): number;
  crosshairStyle(): ChartSizedLineAppearance;
  scalesState(): ChartScalesState;
}

/** The tool test surfaces the hook hands back per tool id. */
export interface DevTestToolSurfaces {
  toolTestApi(id: string): unknown;
}

/** The pointer's time/price labels, which every tool shows while a pointer is over the pane. */
export interface DevTestPointerReadout {
  readout(): PointerReadout | null;
}

/** The empty bars kept to the right of the last bar, which the Canvas tab sets. */
export interface DevTestPaneMargins {
  rightMarginBars(): number;
}

/** The chart's background copied out of the library's own option, whichever kind it is. */
function backgroundState(background: Background): ChartBackgroundState {
  if (background.type === ColorType.VerticalGradient) {
    return { type: background.type, topColor: background.topColor, bottomColor: background.bottomColor };
  }
  return { type: background.type, color: background.color };
}

function gridLineState({ visible, color, style }: GridLineOptions): ChartGridLineState {
  return { visible, color, style };
}

type AppearanceSources = Pick<DevTestApiSources, 'chart' | 'rightMarginBars' | 'crosshairStyle'>;

/** The chart's own paint and margins, read back from the options and the controllers that own them. */
function appearanceState({ chart, rightMarginBars, crosshairStyle }: AppearanceSources): ChartAppearanceState {
  const options = chart.options();
  const margins = chart.priceScale('right').options().scaleMargins;
  const crosshair = crosshairStyle();
  return {
    layout: {
      background: backgroundState(options.layout.background),
      textColor: options.layout.textColor,
      fontSize: options.layout.fontSize,
    },
    grid: {
      vertLines: gridLineState(options.grid.vertLines),
      horzLines: gridLineState(options.grid.horzLines),
    },
    rightPriceScaleBorder: options.rightPriceScale.borderColor,
    timeScaleBorder: options.timeScale.borderColor,
    scaleMargins: { top: margins.top, bottom: margins.bottom },
    rightMarginBars: rightMarginBars(),
    crosshair: { color: crosshair.color, style: crosshair.style, width: crosshair.width },
  };
}

function buildDevTestApi({
  chart,
  bars,
  candles,
  visibleRange,
  timeToX,
  toolTestApi,
  drawings,
  pointerReadout,
  rightMarginBars,
  crosshairStyle,
  scalesState,
}: DevTestApiSources): DevTestApi {
  return {
    data: () => bars().map((bar) => ({ ...bar })),
    candles,
    visibleRange,
    scrollToRange: (range) => chart.timeScale().setVisibleLogicalRange(range),
    viewportChanges: viewportChangeLog,
    clearViewportChanges: clearViewportChangeLog,
    timeToX,
    tool: toolTestApi,
    drawings: () => drawings.exportRecords(),
    selectedDrawing: () => drawings.selected(),
    pointerReadout,
    appearance: () => appearanceState({ chart, rightMarginBars, crosshairStyle }),
    scales: scalesState,
    priceScale: () => {
      const scale = chart.priceScale('right');
      const options = scale.options();
      return {
        autoScale: options.autoScale,
        mode: options.mode,
        axisWidth: scale.width(),
        paneHeight: chart.panes()[0]?.getHeight() ?? 0,
        timeAxisHeight: chart.timeScale().height(),
        range: scale.getVisibleRange(),
      };
    },
  };
}

export function installDevTestApi(sources: DevTestApiSources): void {
  const api = buildDevTestApi(sources);
  const devWindow = window as unknown as DevWindow;
  devWindow.__chartTest = api;
  // Console helper for diagnosing a view that moved on its own: `__viewportLog()`.
  devWindow.__viewportLog = () => console.table(api.viewportChanges().map(describeChange));
}

/**
 * Installs the dev hook from the surface's own handles, so the controller's constructor keeps one
 * call instead of the source wiring. DEV-gated at that call site, like `installDevTestApi` itself.
 */
export function installChartDevTestApi(
  chart: IChartApi,
  candles: ISeriesApi<'Candlestick'>,
  tools: DevTestToolSurfaces,
  pointerReadout: DevTestPointerReadout,
  pane: DevTestPaneMargins,
  readings: DevTestReadings,
): void {
  installDevTestApi({
    chart,
    bars: () => readings.getData(),
    candles: () => readCandleSeriesState(candles),
    visibleRange: () => readings.visibleRange(),
    timeToX: (timeMs) => readings.timeToX(timeMs),
    toolTestApi: (id) => tools.toolTestApi(id),
    drawings: readings.drawings,
    pointerReadout: () => pointerReadout.readout(),
    rightMarginBars: () => pane.rightMarginBars(),
    crosshairStyle: () => readings.crosshairStyle(),
    scalesState: () => readings.scalesState(),
  });
}

export function removeDevTestApi(): void {
  const devWindow = window as unknown as DevWindow;
  delete devWindow.__chartTest;
  delete devWindow.__viewportLog;
}
