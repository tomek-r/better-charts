import { timeframeBarTime } from '../../../shared/bridge/timeframes';
import type { FixedRangeProfileState } from './fixedRangeProfileOverlay';
import type { RenderViewport } from './overlayTypes';
import type { TimeModel } from './viewportController';
import { palette } from '../../../shared/theme/palette';

/** A committed fixed-range volume profile window, `[fromMs, endMs)`. */
export interface ProfileRange {
  fromMs: number;
  endMs: number;
}

/** The viewport geometry the gesture hit-tests against. */
export interface ProfileGeometry {
  viewport(): RenderViewport;
  timeToX(timeMs: number): number;
  barIndexAt(x: number): number | null;
}

export interface FixedRangeProfileDeps {
  data: TimeModel;
  geometry: ProfileGeometry;
  state: FixedRangeProfileState;
  /** Whether the profile tool is the armed drawing tool. */
  isToolActive: () => boolean;
  requestRepaint: () => void;
  onCommit: (range: ProfileRange) => void;
  /** The gesture released the tool; the owner clears the tool and the cursor. */
  onToolRelease: () => void;
  onDelete: () => void;
}

/**
 * The Fixed Range Volume Profile gesture: two clicks place the range, dragging
 * either boundary edits it with a live preview, and a committed range is
 * reported back through `onCommit`.
 *
 * The armed tool is not owned here. This object only reads that fact and reports
 * back through callbacks, so the owner keeps the single `tool` value and the
 * cursor with it. `state` is the shared overlay ref: this tool is the only writer
 * of `previewing`, and the only writer that clears `range` and `profile`. The
 * session hooks also write `range` and `profile` when they issue a request or
 * accept a result, which is why that ref is shared by design.
 */
export class FixedRangeProfileController {
  private first: number | null = null;
  private hover: number | null = null;
  private pressed: number | null = null;
  private selectionLastMs = 0;
  private selection: ProfileRange | null = null;
  private boundary: { side: 'from' | 'end'; original: ProfileRange; preview: ProfileRange; lastMs: number } | null =
    null;

  constructor(private readonly deps: FixedRangeProfileDeps) {}

  /** Whether a click-drag is mid-gesture, which the owner must cancel on a tool switch. */
  hasGesture(): boolean {
    return this.pressed !== null || this.first !== null || this.boundary !== null;
  }

  pointerDown(x: number, y: number): boolean {
    const viewport = this.deps.geometry.viewport();
    if (x < 0 || x > viewport.chartRect.width || y < 0 || y > viewport.chartRect.height) {
      return false;
    }
    if (this.deps.isToolActive()) {
      const index = this.deps.geometry.barIndexAt(x);
      if (index === null) {
        return true;
      }
      this.pressed = index;
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
      this.hover = this.deps.geometry.barIndexAt(x) ?? this.hover;
      this.deps.requestRepaint();
      return true;
    }
    if (!this.boundary) {
      return false;
    }
    const boundary = this.boundary;
    let index = this.deps.geometry.barIndexAt(x);
    if (index !== null) {
      const bars = this.deps.data.bars;
      // Keep a moving boundary on a real candle when it crosses the other
      // boundary; never synthesize endMs ± 1 millisecond anchors.
      if (this.boundary.side === 'from') {
        let maximum = bars.length - 1;
        while (maximum >= 0 && bars[maximum].time * 1000 > this.selectionLastMs) {
          maximum -= 1;
        }
        if (maximum < 0) {
          return true;
        }
        index = Math.min(index, maximum);
      } else {
        const minimum = bars.findIndex((bar) => bar.time * 1000 >= boundary.original.fromMs);
        if (minimum < 0) {
          return true;
        }
        index = Math.max(index, minimum);
      }
      const barRange = this.selectedRange(index, index);
      const original = this.boundary.original;
      if (this.boundary.side === 'end') {
        this.boundary.lastMs = bars[index].time * 1000;
      }
      this.boundary.preview =
        this.boundary.side === 'from'
          ? { fromMs: barRange.fromMs, endMs: original.endMs }
          : { fromMs: original.fromMs, endMs: barRange.endMs };
      this.deps.state.previewing =
        this.boundary.preview.fromMs !== original.fromMs || this.boundary.preview.endMs !== original.endMs;
      this.deps.requestRepaint();
    }
    return true;
  }

  pointerUp(commit: boolean): boolean {
    if (this.pressed !== null) {
      const index = this.pressed;
      this.pressed = null;
      if (commit) {
        if (this.first === null) {
          this.first = this.hover = index;
        } else {
          this.selection = this.selectedRange(this.first, index);
          this.selectionLastMs = this.deps.data.bars[Math.max(this.first, index)].time * 1000;
          this.first = this.hover = null;
          this.deps.onToolRelease();
          this.deps.onCommit({ ...this.selection });
        }
      }
      this.deps.requestRepaint();
      return true;
    }
    const current = this.boundary;
    if (!current) {
      return this.deps.isToolActive();
    }
    this.boundary = null;
    this.deps.state.previewing = false;
    if (
      commit &&
      (current.original.fromMs !== current.preview.fromMs || current.original.endMs !== current.preview.endMs)
    ) {
      this.selection = current.preview;
      this.selectionLastMs = current.lastMs;
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

  clearSelection(): void {
    this.cancelGesture();
    this.selection = null;
    this.deps.state.range = null;
    this.deps.state.profile = undefined;
    this.deps.requestRepaint();
  }

  deleteProfile(): void {
    this.clearSelection();
    this.deps.onDelete();
  }

  getRange(): ProfileRange | null {
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

  drawSelection(ctx: CanvasRenderingContext2D): void {
    const bars = this.deps.data.bars;
    const range =
      this.first !== null && this.hover !== null
        ? this.selectedRange(this.first, this.hover)
        : (this.boundary?.preview ?? this.selection);
    if (!range) {
      return;
    }
    const { height } = this.deps.geometry.viewport().chartRect;
    ctx.strokeStyle = palette.textLabel;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const lastMs =
      this.first !== null && this.hover !== null
        ? bars[Math.max(this.first, this.hover)].time * 1000
        : (this.boundary?.lastMs ?? this.selectionLastMs);
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

  private selectedRange(a: number, b: number): ProfileRange {
    const bars = this.deps.data.bars;
    const start = Math.min(a, b),
      end = Math.max(a, b);
    // Preserve the original end-exclusive rule: the preceding real-bar delta
    // determines the selected last candle end, including session gaps.
    let interval = this.deps.data.intervalSeconds;
    if (this.deps.data.timeframe === 'MN1') {
      interval = timeframeBarTime('MN1', bars[end].time, 1) - bars[end].time;
    } else if (end > 0) {
      interval = bars[end].time - bars[end - 1].time;
    } else if (bars.length > 1) {
      interval = bars[bars.length - 1].time - bars[bars.length - 2].time;
    }
    return { fromMs: bars[start].time * 1000, endMs: (bars[end].time + Math.max(0.001, interval)) * 1000 };
  }
}
