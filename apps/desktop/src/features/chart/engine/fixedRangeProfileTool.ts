import { timeframeBarTime } from '../../../shared/bridge/timeframes';
import type { FixedRangeProfileState } from './fixedRangeProfileOverlay';
import {
  anchorBar,
  barAnchor,
  resolveAnchor,
  type BarAnchor,
  type ChartTool,
  type ChartToolContext,
} from './chartTool';
import { palette } from '../../../shared/theme/palette';

/**
 * A committed fixed-range volume profile window, `[fromMs, endMs)`. The end is
 * time-anchored: it is the end of the slot the user chose, a real bar or an empty
 * future slot, and never moves. Whether the range is still collecting ticks is
 * derived from the newest bar (see `FixedRangeProfileTool.barsChanged`).
 */
export interface FixedRangeProfileRange {
  fromMs: number;
  endMs: number;
}

export interface FixedRangeProfileToolDeps extends ChartToolContext {
  state: FixedRangeProfileState;
  onCommit: (range: FixedRangeProfileRange) => void;
  /**
   * The ticks behind the range may have changed: it is still open, or it was open
   * until this change and needs one final refresh. The owner decides when to refresh.
   */
  onRefresh: (range: FixedRangeProfileRange) => void;
  onDelete: () => void;
}

/** One end of the window: the open time of its last slot and the exclusive end. */
interface RangeEnd {
  lastMs: number;
  endMs: number;
}

/**
 * The Fixed Range Volume Profile gesture: two clicks place the range, dragging
 * either boundary edits it with a live preview, and a committed range is
 * reported back through `onCommit`. The end may sit in the empty area right of the
 * newest bar; the start is always a real bar.
 *
 * The armed tool is not owned here. This object only reads that fact and reports
 * back through callbacks, so the owner keeps the single `tool` value and the
 * cursor with it. `state` is the shared overlay ref: this tool is the only writer
 * of `previewing`, and the only writer that clears `range` and `profile`. The
 * session hooks also write `range` and `profile` when they issue a request or
 * accept a result, which is why that ref is shared by design.
 */
export class FixedRangeProfileTool implements ChartTool {
  readonly id = 'fixedRangeProfile' as const;
  private first: BarAnchor | null = null;
  private hover: BarAnchor | null = null;
  private pressed: BarAnchor | null = null;
  private selectionLastMs = 0;
  private selection: FixedRangeProfileRange | null = null;
  /** The newest bar opened before the range end when last checked: its last bar may still gain ticks. */
  private open = false;
  private boundary: {
    side: 'from' | 'end';
    original: FixedRangeProfileRange;
    preview: FixedRangeProfileRange;
    lastMs: number;
  } | null = null;

  constructor(private readonly deps: FixedRangeProfileToolDeps) {}

  /** Whether a click-drag is mid-gesture, which the owner must cancel on a tool switch. */
  hasGesture(): boolean {
    return this.pressed !== null || this.first !== null || this.boundary !== null;
  }

  pointerDown(x: number, y: number, armed: boolean): boolean {
    const viewport = this.deps.geometry.viewport();
    if (x < 0 || x > viewport.chartRect.width || y < 0 || y > viewport.chartRect.height) {
      return false;
    }
    if (armed) {
      const anchor = anchorBar(this.deps, x);
      if (anchor === null) {
        return true;
      }
      this.pressed = anchor;
      this.deps.requestRepaint();
      return true;
    }
    const bounds = this.boundaries();
    if (!bounds || !this.selection) {
      return false;
    }
    let side: 'from' | 'end' | null = null;
    if (Math.abs(x - bounds.fromX) <= 7) {
      side = 'from';
    } else if (Math.abs(x - bounds.toX) <= 7) {
      side = 'end';
    }
    if (!side) {
      return false;
    }
    this.boundary = {
      side,
      original: { ...this.selection },
      preview: { ...this.selection },
      lastMs: this.selectionLastMs,
    };
    this.deps.requestRepaint();
    return true;
  }

  pointerMove(x: number): boolean {
    if (this.first !== null) {
      this.hover = anchorBar(this.deps, x) ?? this.hover;
      this.deps.requestRepaint();
      return true;
    }
    if (!this.boundary) {
      return false;
    }
    const boundary = this.boundary;
    let anchor = anchorBar(this.deps, x);
    if (anchor !== null) {
      const { data } = this.deps;
      const bars = data.bars;
      // Keep a moving boundary on a real candle when it crosses the other
      // boundary; never synthesize endMs ± 1 millisecond anchors.
      if (boundary.side === 'from') {
        let maximum = bars.length - 1;
        while (maximum >= 0 && bars[maximum].time * 1000 > this.selectionLastMs) {
          maximum -= 1;
        }
        if (maximum < 0) {
          return true;
        }
        const index = Math.min(anchor.index, maximum);
        boundary.preview = { fromMs: bars[index].time * 1000, endMs: boundary.original.endMs };
      } else {
        const minimum = bars.findIndex((bar) => bar.time * 1000 >= boundary.original.fromMs);
        if (minimum < 0) {
          return true;
        }
        if (anchor.index < minimum) {
          anchor = barAnchor(data, minimum);
        }
        const end = this.rangeEnd(anchor);
        boundary.lastMs = end.lastMs;
        boundary.preview = { fromMs: boundary.original.fromMs, endMs: end.endMs };
      }
      this.deps.state.previewing = !sameRange(boundary.preview, boundary.original);
      this.deps.requestRepaint();
    }
    return true;
  }

  pointerUp(commit: boolean): boolean {
    if (this.pressed !== null) {
      const anchor = this.pressed;
      this.pressed = null;
      if (commit) {
        if (this.first === null) {
          this.first = this.hover = anchor;
        } else {
          const placed = this.span(this.first, anchor);
          this.selection = placed.range;
          this.selectionLastMs = placed.lastMs;
          this.open = this.isOpen(placed.range);
          this.first = this.hover = null;
          this.deps.releaseTool();
          this.deps.onCommit({ ...this.selection });
        }
      }
      this.deps.requestRepaint();
      return true;
    }
    const current = this.boundary;
    if (!current) {
      return false;
    }
    this.boundary = null;
    this.deps.state.previewing = false;
    if (commit && !sameRange(current.original, current.preview)) {
      this.selection = current.preview;
      this.selectionLastMs = current.lastMs;
      this.open = this.isOpen(current.preview);
      this.deps.onCommit({ ...current.preview });
    }
    this.deps.requestRepaint();
    return true;
  }

  cancelGesture(): void {
    this.pointerUp(false);
    this.first = this.hover = null;
    this.deps.requestRepaint();
  }

  /**
   * Reports a range whose last slot has not yet been passed by the newest bar.
   * Reported on every change, not only on a new bar, because ticks inside the
   * forming bar belong to the profile too; the owner throttles the refresh. The
   * change in which a bar opens at or after `endMs` is reported once more, as the
   * final refresh, and later changes are not. The end itself never moves, so the
   * range is re-evaluated against whatever the newest bar is, e.g. after a
   * timeframe switch.
   */
  barsChanged(): void {
    const selection = this.selection;
    // A boundary drag owns the range until it is released or cancelled.
    if (!selection || this.boundary || this.deps.data.bars.length === 0) {
      return;
    }
    const wasOpen = this.open;
    this.open = this.isOpen(selection);
    if (wasOpen || this.open) {
      this.deps.onRefresh({ ...selection });
    }
  }

  clearSelection(): void {
    this.cancelGesture();
    this.selection = null;
    this.open = false;
    this.deps.state.range = null;
    this.deps.state.profile = undefined;
    this.deps.requestRepaint();
  }

  deleteProfile(): void {
    this.clearSelection();
    this.deps.onDelete();
  }

  deleteDrawing(): boolean {
    if (!this.selection && !this.hasGesture()) {
      return false;
    }
    this.deleteProfile();
    return true;
  }

  getRange(): FixedRangeProfileRange | null {
    return this.selection ? { ...this.selection } : null;
  }

  boundaries() {
    const range = this.boundary?.preview ?? this.selection;
    return range
      ? {
          fromX: this.deps.geometry.timeToX(range.fromMs),
          toX: this.deps.geometry.timeToX(this.boundary?.lastMs ?? this.selectionLastMs),
          range: { ...range },
        }
      : null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const placing = this.first !== null && this.hover !== null ? this.span(this.first, this.hover) : null;
    const range = placing?.range ?? this.boundary?.preview ?? this.selection;
    if (!range) {
      return;
    }
    const { height } = this.deps.geometry.viewport().chartRect;
    ctx.strokeStyle = palette.textLabel;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const lastMs = placing?.lastMs ?? this.boundary?.lastMs ?? this.selectionLastMs;
    for (const time of [range.fromMs, lastMs]) {
      const x = this.deps.geometry.timeToX(time);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, height / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = palette.panel;
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([4, 3]);
    }
    ctx.setLineDash([]);
  }

  /** Whether the newest bar still opens before the range end, i.e. its last slot is not passed yet. */
  private isOpen(range: FixedRangeProfileRange): boolean {
    const bars = this.deps.data.bars;
    return bars.length > 0 && bars[bars.length - 1].time * 1000 < range.endMs;
  }

  /** The window between two anchors; its start is a real bar, so a future start is clamped to the newest bar. */
  private span(a: BarAnchor, b: BarAnchor): { range: FixedRangeProfileRange; lastMs: number } {
    const { data } = this.deps;
    // Stored anchors outlive bar changes; their time, not their slot, is the identity.
    const [early, late] = [resolveAnchor(data, a), resolveAnchor(data, b)].sort((x, y) => x.timeMs - y.timeMs);
    const start = barAnchor(data, Math.min(early.index, data.bars.length - 1));
    const end = this.rangeEnd(late);
    return { range: { fromMs: start.timeMs, endMs: end.endMs }, lastMs: end.lastMs };
  }

  private rangeEnd(anchor: BarAnchor): RangeEnd {
    const { bars, timeframe, intervalSeconds } = this.deps.data;
    if (anchor.future) {
      // Same end-exclusive rule as a real bar, stepped by the timeframe from the newest bar.
      const newest = bars[bars.length - 1].time;
      const endSeconds = timeframeBarTime(timeframe, newest, anchor.index - (bars.length - 1) + 1);
      return { lastMs: anchor.timeMs, endMs: endSeconds * 1000 };
    }
    const end = anchor.index;
    // Preserve the original end-exclusive rule: the preceding real-bar delta
    // determines the selected last candle end, including session gaps.
    let interval = intervalSeconds;
    if (timeframe === 'MN1') {
      interval = timeframeBarTime('MN1', bars[end].time, 1) - bars[end].time;
    } else if (end > 0) {
      interval = bars[end].time - bars[end - 1].time;
    } else if (bars.length > 1) {
      interval = bars[bars.length - 1].time - bars[bars.length - 2].time;
    }
    return { lastMs: anchor.timeMs, endMs: (bars[end].time + Math.max(0.001, interval)) * 1000 };
  }
}

function sameRange(a: FixedRangeProfileRange, b: FixedRangeProfileRange): boolean {
  return a.fromMs === b.fromMs && a.endMs === b.endMs;
}
