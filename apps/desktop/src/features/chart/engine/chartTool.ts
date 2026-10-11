import { timeframeBarOffset, timeframeBarTime } from '../../../shared/bridge/timeframes';
import type { ChartToolId } from '../../tools/toolTypes';
import type { RenderViewport } from './overlayTypes';
import type { TimeModel } from './viewportController';

/** The viewport geometry a tool hit-tests against, in pane CSS pixels. */
export interface ToolGeometry {
  viewport(): RenderViewport;
  timeToX(timeMs: number): number;
  /** Whole logical slot under a pane x: a bar index, or past the newest bar a future slot. */
  slotAt(x: number): number | null;
}

/** What the controller hands every tool: the bars, the geometry and a repaint. */
export interface ChartToolContext {
  data: TimeModel;
  geometry: ToolGeometry;
  requestRepaint: () => void;
  /** The tool finished placing its drawing; the owner disarms it and resets the cursor. */
  releaseTool: () => void;
}

/**
 * A drawing tool on the chart pane. The chart controller owns which tool is armed and
 * routes every pointer event through this contract: the armed tool first (with
 * `armed` set, so it may start a new drawing), then every tool in turn so an
 * existing drawing can be edited with no tool armed.
 *
 * Each pointer method returns whether the tool consumed the event; a consumed
 * press makes the caller capture the pointer and keep the library from panning.
 */
export interface ChartTool {
  readonly id: ChartToolId;
  /** A press, drag or half-placed drawing is in progress. */
  hasGesture(): boolean;
  pointerDown(x: number, y: number, armed: boolean): boolean;
  pointerMove(x: number, y: number): boolean;
  pointerUp(commit: boolean): boolean;
  /** Drops an in-progress gesture and restores the committed drawing. */
  cancelGesture(): void;
  /** Removes the tool's drawing at the user's request; false when it had none. */
  deleteDrawing(): boolean;
  /** Paints the tool's handles and in-progress selection above the overlay layer. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** The bar series changed: a live bar update, a new bar or a replaced history. */
  barsChanged(): void;
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
export function barAnchor(data: TimeModel, index: number): BarAnchor {
  return { index, timeMs: data.bars[index].time * 1000, future: false };
}

/**
 * The slot a tool anchors to under a pane x. Over a real bar it is that bar; in
 * the empty area right of the newest bar it is the future slot under the pointer,
 * not the newest bar, so a drawing can end at a time that has not happened yet.
 * Before the oldest bar there is no data to anchor to, so it stays null.
 */
export function anchorBar(context: ChartToolContext, x: number): BarAnchor | null {
  const slot = context.geometry.slotAt(x);
  const { bars, timeframe } = context.data;
  if (slot === null || slot < 0 || bars.length === 0) {
    return null;
  }
  if (slot < bars.length) {
    return barAnchor(context.data, slot);
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
export function resolveAnchor(data: TimeModel, anchor: BarAnchor): BarAnchor {
  const { bars, timeframe } = data;
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
    return barAnchor(data, low);
  }
  const steps = Math.round(timeframeBarOffset(timeframe, bars[low].time, anchor.timeMs / 1000));
  return { index: low + steps, timeMs: anchor.timeMs, future: true };
}
