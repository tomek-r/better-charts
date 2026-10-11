import { timeframeBarOffset, timeframeBarTime } from '../../../shared/bridge/timeframes';
import type { QuoteSnapshot } from '../../../shared/bridge/types';
import type { MarketDataPort } from '../../bridge/marketDataPort';
import type { RenderViewport } from './overlayTypes';

export type { RenderViewport };
import type { TimeModel } from './viewportController';

/** The viewport geometry a tool hit-tests against, in pane CSS pixels. */
export interface ChartToolGeometry {
  viewport(): RenderViewport;
  timeToX(timeMs: number): number;
  /**
   * Pane y of a price, NaN while the price is off the scale. Display-only: a number from
   * here positions pixels and must never become an order input.
   */
  priceToY(price: number): number;
  /**
   * Price under a pane y, NaN while the scale has no range. Display-only: a number from
   * here is a chart coordinate and must never become an order input.
   */
  yToPrice(y: number): number;
  /** Whole logical slot under a pane x: a bar index, or past the newest bar a future slot. */
  slotAt(x: number): number | null;
}

/**
 * Where in the paint stack a tool's `draw` is called: which canvas, and at which
 * z-position on it. The engine calls every tool's `draw` once per layer pass, in
 * registry order; a tool returns early for the layers it does not use.
 *
 * `surface`:
 * - `pane`: the plot area. Coordinates are pane CSS px.
 * - `timeAxis`: the time-axis canvas, as is, in its own CSS px.
 * - `priceAxis`: the price-axis canvas. At `belowTradingOverlays` the context is shifted
 *   so pane x coordinates still apply (anything left of the axis is off canvas); at
 *   `aboveTradingOverlays` it is the canvas as is, in its own CSS px.
 *
 * `depth`:
 * - `belowTradingOverlays`: under the position/order/staged zones and labels (and, on
 *   the price axis, under the axis tags).
 * - `aboveTradingOverlays`: above every trading overlay, under the pointer readout labels.
 *
 * The combinations that exist are `pane` and `priceAxis` at `belowTradingOverlays`, and
 * `pane`, `timeAxis` and `priceAxis` at `aboveTradingOverlays`. The three
 * `aboveTradingOverlays` surfaces are painted only while the pointer is over the pane,
 * so a line can follow the pointer across the axes (separate canvases).
 */
export interface ChartDrawLayer {
  readonly surface: 'pane' | 'timeAxis' | 'priceAxis';
  readonly depth: 'belowTradingOverlays' | 'aboveTradingOverlays';
}

/**
 * The canvas in device pixels, for crisp one-pixel lines. A canvas has one transform at
 * a time, so the bitmap context is only valid inside `withContext`: the callback gets the
 * same canvas with an identity transform, and the transform is restored afterwards.
 * The bitmap space is the raw canvas: the shift `priceAxis` applies at
 * `belowTradingOverlays` does not carry over.
 */
export interface ChartBitmapSpace {
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
  /** The canvas size in device pixels. */
  readonly width: number;
  readonly height: number;
  withContext(paint: (context: CanvasRenderingContext2D) => void): void;
}

/**
 * What a tool's `draw` receives for one layer pass. The tool set wraps every call in
 * `save()`/`restore()`, so styles, dashes, clips and transforms a tool sets never reach
 * the next tool.
 */
export interface ChartDrawTarget {
  /** The canvas in media space: CSS pixels, already scaled to the device pixel ratio. */
  readonly context: CanvasRenderingContext2D;
  readonly viewport: RenderViewport;
  readonly layer: ChartDrawLayer;
  readonly bitmap: ChartBitmapSpace;
}

/**
 * A tool on the chart pane. The chart controller owns which tool is active and
 * routes every pointer event through this contract: the active tool first (with
 * purpose `startNewDrawing`), then every tool in turn so an
 * existing drawing can be edited with no tool active.
 *
 * Every member is optional; a tool implements what it uses. The tool set treats a
 * missing member as a no-op: a missing `pointerDown`/`pointerMove`/`pointerUp`
 * means the event was not consumed, a missing `hasGesture`/`deleteDrawing` means
 * false, and every other missing member is skipped.
 *
 * Each pointer method returns whether the tool consumed the event; a consumed
 * press makes the caller capture the pointer and keep the library from panning.
 */
export interface ChartTool {
  /** A press, drag or half-placed drawing is in progress. */
  hasGesture?(): boolean;
  /** The tool just became the active one. */
  activate?(): void;
  /** The tool stopped being the active one (another was picked, or the default tool was restored). */
  deactivate?(): void;
  /**
   * `startNewDrawing`: the tool is the active one and may begin a new drawing.
   * `editExistingDrawing`: offered to every other tool so a committed drawing stays
   * editable (e.g. dragging a boundary) while a different tool is active.
   */
  pointerDown?(x: number, y: number, purpose: ChartPointerDownPurpose): boolean;
  pointerMove?(x: number, y: number): boolean;
  /**
   * The press ended. `released`: the pointer was lifted, so a gesture in progress
   * commits. `cancelled`: the system or the app interrupted the press (pointer
   * cancel, a tool switch, Escape), so the gesture is dropped and nothing commits.
   */
  pointerUp?(outcome: ChartPointerUpOutcome): boolean;
  /**
   * The pointer moved over the chart pane (pane CSS px). Sent to the ACTIVE tool only,
   * for every move, whether or not another tool consumes it through `pointerMove`.
   * A tool that becomes active while the pointer already rests in the pane is told straight away.
   */
  pointerHover?(x: number, y: number): void;
  /** The pointer left the pane (or moved onto an axis); also sent when the tool stops being active. */
  pointerLeave?(): void;
  /** Drops an in-progress gesture and restores the committed drawing. */
  cancelGesture?(): void;
  /** Removes the tool's drawing at the user's request; false when it had none. */
  deleteDrawing?(): boolean;
  /** Paints the tool's content for one layer pass (see `ChartDrawLayer`, `ChartDrawTarget`). */
  draw?(target: ChartDrawTarget): void;
  /** The bar series changed: a live bar update, a new bar or a replaced history. */
  barsChanged?(): void;
  /**
   * Drops state tied to the instrument, session or connection that went away.
   * `symbol`: the drawing is instrument-specific and goes, together with any
   * backend work behind it. `disconnect` and `session`: state is cleared locally.
   */
  reset?(reason: ChartToolResetReason): void;
  dispose?(): void;
  /** Development builds only: a read-only view of the tool's state for the e2e suite. */
  testApi?(): unknown;
}

/** Why a press is offered to a tool. */
export type ChartPointerDownPurpose = 'startNewDrawing' | 'editExistingDrawing';

/** How a press ended. */
export type ChartPointerUpOutcome = 'released' | 'cancelled';

/**
 * Everything a tool may reach on the chart: the bars, the geometry and a repaint,
 * plus the app's market state. Market data comes only through the read-only
 * `marketDataPort`: a tool has no access to Tauri `invoke`/`listen`, so it
 * cannot reach execution commands.
 */
export interface ChartToolHost {
  barSeries: TimeModel;
  geometry: ChartToolGeometry;
  requestRepaint: () => void;
  /** The tool finished placing its drawing; the controller makes the default tool active again. */
  returnToDefaultTool: () => void;
  /** The chart's current selection, as the app has accepted it. */
  currentMarket: {
    symbol(): string | undefined;
    quote(): QuoteSnapshot | undefined;
  };
  marketDataPort: MarketDataPort;
  /** Surfaces a failure to the user. */
  notifyError(message: string): void;
}

/** Why the host resets its tools. */
export type ChartToolResetReason = 'symbol' | 'disconnect' | 'session';

/**
 * What the engine needs to know about a tool: its behavior, nothing about how the app
 * presents it. The app's rail metadata lives in `features/tools` (`ChartToolPlugin`).
 */
export interface ChartToolDefinition {
  readonly id: string;
  /** The pane cursor while this tool is active, as a CSS `cursor` value. Omitted keeps the chart's normal cursor. */
  readonly cursor?: string;
  /**
   * The tool places a drawing and is then released: the default tool becomes active again
   * after it commits, and its presses are offered to it ahead of the chart's other
   * overlays. Pointer tools stay active until another is picked.
   */
  readonly placesDrawings: boolean;
  /** The engine builds the tool once per chart with `new toolClass(host)`. */
  readonly toolClass: new (host: ChartToolHost) => ChartTool;
}

/**
 * A pointer anchored to a time slot. `index` counts bars from the oldest; a
 * `future` slot has `index >= bars.length`, and `timeMs` is its open time stepped
 * from the newest bar by the timeframe (calendar months for MN1).
 */
export interface BarAnchor {
  index: number;
  timeMs: number;
  future: boolean;
}

/** The anchor of a real bar. */
export function anchorAtBar(barSeries: TimeModel, index: number): BarAnchor {
  return { index, timeMs: barSeries.bars[index].time * 1000, future: false };
}

/**
 * The slot a tool anchors to under a pane x. Over a real bar it is that bar; in
 * the empty area right of the newest bar it is the future slot under the pointer,
 * not the newest bar, so a drawing can end at a time that has not happened yet.
 * Before the oldest bar there is no data to anchor to, so it stays null.
 */
export function anchorAtX(host: ChartToolHost, x: number): BarAnchor | null {
  const slot = host.geometry.slotAt(x);
  const { bars, timeframe } = host.barSeries;
  if (slot === null || slot < 0 || bars.length === 0) {
    return null;
  }
  if (slot < bars.length) {
    return anchorAtBar(host.barSeries, slot);
  }
  const newest = bars[bars.length - 1];
  const timeMs = timeframeBarTime(timeframe, newest.time, slot - (bars.length - 1)) * 1000;
  return Number.isFinite(timeMs) ? { index: slot, timeMs, future: true } : null;
}

/**
 * Re-resolves a stored anchor against the current bars. `index` is only valid for
 * the bars it was taken from; `timeMs` is the stable identity, so after a new bar
 * or prepended history the anchor is found again by time: a real bar by lookup,
 * a time past the newest bar as a future slot counted in timeframe steps.
 */
export function reanchorToCurrentBars(barSeries: TimeModel, anchor: BarAnchor): BarAnchor {
  const { bars, timeframe } = barSeries;
  if (bars.length === 0) {
    return anchor;
  }
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (bars[mid].time * 1000 < anchor.timeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (bars[low].time * 1000 >= anchor.timeMs || low < bars.length - 1) {
    return anchorAtBar(barSeries, low);
  }
  const steps = Math.round(timeframeBarOffset(timeframe, bars[low].time, anchor.timeMs / 1000));
  return { index: low + steps, timeMs: anchor.timeMs, future: true };
}
