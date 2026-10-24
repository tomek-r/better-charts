import {
  anchorAtX,
  anchorAtBar,
  type BarAnchor,
  type ChartDrawTarget,
  type ChartPointerDownPurpose,
  type ChartPointerUpOutcome,
  type ChartTool,
  type ChartToolHost,
  type ChartToolResetReason,
} from '../../chart/engine/toolContract';
import { palette } from '../../../shared/theme/palette';
import { FixedRangeProfileRequester } from './requester';
import {
  drawFixedRangeProfile,
  drawFixedRangeProfileLoadingWash,
  drawFixedRangeProfileSpinner,
  type FixedRangeProfileState,
} from './overlay';
import { isRangeOpen, rangeEndingAtAnchor, sameRange, spanBetweenAnchors, type PlacedFixedRangeProfile } from './range';

/** Where the two drag handles sit, in pane CSS px, and the range they delimit. */
interface FixedRangeProfileBoundaries {
  fromX: number;
  toX: number;
  range: { fromMs: number; endMs: number };
}

/** What the e2e suite reads through `window.__chartTest.tool('fixedRangeProfile')` (dev builds only). */
export interface FixedRangeProfileTestApi {
  /** Handle x positions and the range as the tool currently shows it (null = no range). */
  boundaries(): FixedRangeProfileBoundaries | null;
  /** The active selection (null = cleared) and whether its computed profile is loaded and visible. */
  selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
}

/**
 * The Fixed Range Volume Profile tool: the gesture, its painter and its profile requester.
 * The gesture: two clicks place the range, and dragging either boundary edits it
 * with a live preview. A placed or edited range is handed to the requester, which
 * requests its profile. The end may sit in the empty area right of the newest bar;
 * the start is always a real bar.
 *
 * Which tool is active is not decided here: once the range is placed the tool asks the
 * host to return to the default tool. `state` is the overlay's state: this tool is the only writer of
 * `previewing`, and the only writer that clears `range` and `profile`. The
 * `FixedRangeProfileRequester` also writes `range` and `profile` when it issues a
 * request or accepts a result, which is why that object is shared by design.
 */
export class FixedRangeProfileTool implements ChartTool {
  private first: BarAnchor | null = null;
  private hover: BarAnchor | null = null;
  private pressed: BarAnchor | null = null;
  private selection: PlacedFixedRangeProfile | null = null;
  /** Whether the newest bar opened before the range end at the last bar change: its last bar may still gain ticks. */
  private wasOpenAtLastBarsChange = false;
  /** The timeframe of the bars `wasOpenAtLastBarsChange` was judged on. */
  private lastTimeframe: string | undefined;
  private boundary: {
    side: 'from' | 'end';
    original: PlacedFixedRangeProfile;
    preview: PlacedFixedRangeProfile;
  } | null = null;

  private readonly state: FixedRangeProfileState = { range: null, hit: {} };
  private readonly requester: FixedRangeProfileRequester;

  constructor(private readonly host: ChartToolHost) {
    this.requester = new FixedRangeProfileRequester(host, this.state, () => this.selection);
  }

  /** Whether a click-drag is mid-gesture, which the owner must cancel on a tool switch. */
  hasGesture(): boolean {
    return this.pressed !== null || this.first !== null || this.boundary !== null;
  }

  pointerDown(x: number, y: number, purpose: ChartPointerDownPurpose): boolean {
    const viewport = this.host.geometry.viewport();
    if (x < 0 || x > viewport.chartRect.width || y < 0 || y > viewport.chartRect.height) {
      return false;
    }
    if (purpose === 'startNewDrawing') {
      const anchor = anchorAtX(this.host, x);
      if (anchor === null) {
        return true;
      }
      this.pressed = anchor;
      this.host.requestRepaint();
      return true;
    }
    const selection = this.selection;
    const bounds = this.boundaries();
    if (!selection || !bounds) {
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
    this.boundary = { side, original: selection, preview: selection };
    this.host.requestRepaint();
    return true;
  }

  pointerMove(x: number): boolean {
    if (this.first !== null) {
      this.hover = anchorAtX(this.host, x) ?? this.hover;
      this.host.requestRepaint();
      return true;
    }
    const boundary = this.boundary;
    if (!boundary) {
      return false;
    }
    const anchor = anchorAtX(this.host, x);
    if (anchor === null) {
      return true;
    }
    const { barSeries } = this.host;
    const { bars } = barSeries;
    const { original } = boundary;
    // Keep a moving boundary on a real candle when it crosses the other
    // boundary; never synthesize endMs ± 1 millisecond anchors.
    if (boundary.side === 'from') {
      let lastAllowedIndex = bars.length - 1;
      while (lastAllowedIndex >= 0 && bars[lastAllowedIndex].time * 1000 > original.lastSlotOpenMs) {
        lastAllowedIndex -= 1;
      }
      if (lastAllowedIndex < 0) {
        return true;
      }
      const index = Math.min(anchor.index, lastAllowedIndex);
      boundary.preview = { ...original, fromMs: bars[index].time * 1000 };
    } else {
      const firstAllowedIndex = bars.findIndex((bar) => bar.time * 1000 >= original.fromMs);
      if (firstAllowedIndex < 0) {
        return true;
      }
      const endAnchor = anchor.index < firstAllowedIndex ? anchorAtBar(barSeries, firstAllowedIndex) : anchor;
      boundary.preview = rangeEndingAtAnchor(barSeries, original.fromMs, endAnchor);
    }
    this.state.previewing = !sameRange(boundary.preview, original);
    this.host.requestRepaint();
    return true;
  }

  pointerUp(outcome: ChartPointerUpOutcome): boolean {
    const commit = outcome === 'released';
    if (this.pressed !== null) {
      const anchor = this.pressed;
      this.pressed = null;
      if (commit) {
        if (this.first === null) {
          this.first = this.hover = anchor;
        } else {
          const placed = spanBetweenAnchors(this.host.barSeries, this.first, anchor);
          this.selection = placed;
          this.markPlaced(placed);
          this.first = this.hover = null;
          this.host.returnToDefaultTool();
          this.requester.requestProfile(placed);
        }
      }
      this.host.requestRepaint();
      return true;
    }
    const current = this.boundary;
    if (!current) {
      return false;
    }
    this.boundary = null;
    this.state.previewing = false;
    if (commit && !sameRange(current.original, current.preview)) {
      this.selection = current.preview;
      this.markPlaced(current.preview);
      this.requester.requestProfile(current.preview);
    }
    this.host.requestRepaint();
    return true;
  }

  cancelGesture(): void {
    this.pointerUp('cancelled');
    this.first = this.hover = null;
    this.host.requestRepaint();
  }

  /**
   * Reports a range whose last slot has not yet been passed by the newest bar.
   * Reported on every change, not only on a new bar, because ticks inside the
   * forming bar belong to the profile too; the requester throttles the refresh. The
   * change in which a bar opens at or after `endMs` is reported once more, as the
   * final refresh, and later changes are not. The end itself never moves, so the
   * range is re-evaluated against whatever the newest bar is, e.g. after a
   * timeframe switch.
   */
  barsChanged(): void {
    const selection = this.selection;
    // A boundary drag owns the range until it is released or cancelled.
    if (!selection || this.boundary || this.host.barSeries.bars.length === 0) {
      return;
    }
    const wasOpen = this.wasOpenAtLastBarsChange;
    this.wasOpenAtLastBarsChange = this.isOpen(selection);
    const timeframe = this.host.barSeries.timeframe;
    if (timeframe !== this.lastTimeframe) {
      // The profile is timeframe-independent, so "was open" on the previous timeframe's bars is no reason for a
      // final refresh. A request still unsettled is renewed rather than waited for; a loaded profile stays.
      this.lastTimeframe = timeframe;
      this.requester.renewUnsettledRequest(selection);
      if (this.wasOpenAtLastBarsChange) {
        this.requester.requestThrottledRefresh(selection);
      }
      return;
    }
    if (wasOpen || this.wasOpenAtLastBarsChange) {
      this.requester.requestThrottledRefresh(selection);
    }
  }

  /** Records the committed range and the timeframe whose bars it is judged against. */
  private markPlaced(range: PlacedFixedRangeProfile): void {
    this.lastTimeframe = this.host.barSeries.timeframe;
    this.wasOpenAtLastBarsChange = this.isOpen(range);
  }

  /** Whether the range may still gain ticks, judged by the newest bar and by the feed's newest quote. */
  private isOpen(range: PlacedFixedRangeProfile): boolean {
    const { currentMarket, barSeries } = this.host;
    const quote = currentMarket.quote();
    const quoteTimeMs =
      quote && quote.symbol === currentMarket.symbol() && Number.isFinite(quote.timeMs) ? quote.timeMs : undefined;
    return isRangeOpen(barSeries, range, quoteTimeMs);
  }

  deleteDrawing(): boolean {
    if (!this.selection && !this.hasGesture()) {
      return false;
    }
    this.clearSelection();
    this.requester.cancelRequest();
    return true;
  }

  private clearSelection(): void {
    this.cancelGesture();
    this.selection = null;
    this.wasOpenAtLastBarsChange = false;
    this.state.range = null;
    this.state.profile = undefined;
    this.host.requestRepaint();
  }

  private boundaries(): FixedRangeProfileBoundaries | null {
    const range = this.boundary?.preview ?? this.selection;
    return range
      ? {
          fromX: this.host.geometry.timeToX(range.fromMs),
          toX: this.host.geometry.timeToX(range.lastSlotOpenMs),
          range: { fromMs: range.fromMs, endMs: range.endMs },
        }
      : null;
  }

  draw({ context: ctx, viewport, layer }: ChartDrawTarget): void {
    // The price-axis pass paints nothing: the histogram clips to the pane rect, which
    // that pass shifts entirely off the axis canvas.
    if (layer.surface !== 'pane' || layer.depth !== 'belowTradingOverlays') {
      return;
    }
    // The histogram first, isolated so its style does not leak, then the handles.
    ctx.save();
    drawFixedRangeProfile(ctx, viewport, this.state);
    ctx.restore();
    // Veil the histogram but not the handles, which stay crisp; the spinner goes on top of both.
    const handles = this.boundaries() ?? undefined;
    drawFixedRangeProfileLoadingWash(ctx, viewport, this.state, handles);
    this.drawSelection(ctx, viewport);
    drawFixedRangeProfileSpinner(ctx, viewport, this.state, Date.now(), handles);
  }

  private drawSelection(ctx: CanvasRenderingContext2D, viewport: ChartDrawTarget['viewport']): void {
    const placing =
      this.first !== null && this.hover !== null
        ? spanBetweenAnchors(this.host.barSeries, this.first, this.hover)
        : null;
    const range = placing ?? this.boundary?.preview ?? this.selection;
    if (!range) {
      return;
    }
    const { height } = viewport.chartRect;
    ctx.strokeStyle = palette.textLabel;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const time of [range.fromMs, range.lastSlotOpenMs]) {
      const x = this.host.geometry.timeToX(time);
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

  /**
   * The selection is instrument-specific, so a symbol change that finds one cancels the
   * backend request behind it; a disconnect or a new session only abandons it locally.
   * Either way a late event for the old request is stale.
   */
  reset(reason: ChartToolResetReason): void {
    const hadSelection = this.selection !== null;
    this.clearSelection();
    if (reason === 'symbol' && hadSelection) {
      this.requester.cancelRequest();
    } else {
      this.requester.abandonPendingRequest();
    }
  }

  dispose(): void {
    this.requester.dispose();
  }

  testApi(): FixedRangeProfileTestApi {
    return {
      boundaries: () => this.boundaries(),
      selection: () => {
        const range = this.state.range;
        return {
          range: range ? { fromMs: range.fromMs, toMs: range.toMs } : null,
          hasProfile: this.state.profile !== undefined && !this.state.previewing,
        };
      },
    };
  }
}
