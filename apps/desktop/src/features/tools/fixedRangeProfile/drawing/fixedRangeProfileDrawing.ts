import type { ChartDrawingPoint } from '../../../chart/engine/drawings/drawingRecord';
import type { ToolInputValues } from '../../../chart/engine/drawings/toolInputs';
import type { ChartDrawingShape } from '../../../chart/engine/drawings/toolDrawings';
import {
  anchorAtBar,
  type BarAnchor,
  type ChartToolGeometry,
  type ChartToolHost,
  type RenderViewport,
} from '../../../chart/engine/tools/toolContract';
import { palette } from '../../../../shared/theme/palette';
import {
  drawFixedRangeProfile,
  drawFixedRangeProfileLoadingWash,
  drawFixedRangeProfileSpinner,
  type FixedRangeProfileState,
  type HandleEdges,
} from '../overlay';
import {
  isRangeOpen,
  lastSlotOpenBefore,
  minuteAlignedWindow,
  rangeEndingAtAnchor,
  type FixedRangeProfileRange,
  type PlacedFixedRangeProfile,
} from '../range';
import { FixedRangeProfileRequester } from '../requests/fixedRangeProfileRequester';
import {
  DEFAULT_FIXED_RANGE_PROFILE_SETTINGS,
  readFixedRangeProfileSettings,
  sameProfileRequestParams,
  type FixedRangeProfileSettings,
} from '../settings';
import type { TickProfileRequestQueue } from '../requests/tickProfileRequestQueue';
import { fixedRangeProfilePoints } from './fixedRangeProfilePoints';

/** How close to a handle a press or a hit test counts as that handle, in pane CSS px. */
export const HANDLE_HIT_PX = 7;
/** Radius of a handle circle, in pane CSS px. */
const HANDLE_RADIUS_PX = 4;
/** The dash of the two boundary lines: 4 px on, 3 px off. */
const HANDLE_DASH_PX = [4, 3];

/** How one drawing paints itself: the selection highlight, and the range a boundary drag previews. */
export interface FixedRangeProfilePaintOptions {
  selected: boolean;
  preview?: PlacedFixedRangeProfile;
}

/** What one drawing reports about itself: its window and whether its computed profile is painted. */
export interface FixedRangeProfileDrawingSummary {
  range: { fromMs: number; endMs: number };
  hasProfile: boolean;
}

/** Whether a pane point lies outside the plot area, where no drawing is hit. */
export function outsidePane(chartRect: { width: number; height: number }, x: number, y: number): boolean {
  return x < 0 || x > chartRect.width || y < 0 || y > chartRect.height;
}

/**
 * One placed fixed-range volume profile: its window, the slot its right-hand handle sits on, its
 * overlay state and the request behind it. The tool's collection owns its id, lock, visibility and
 * settings; a drawing owns everything about what it shows, so two drawings never share a request, a
 * result or a paint.
 *
 * The two factories are the only ways in: `placed` for a range the user just committed, `restored`
 * for one the app read back from storage. A restored window the loaded bars cannot place yet (they
 * had none, or started after it) stays a drawing without a slot: it exports unchanged, paints
 * nothing and asks for nothing until the bars that hold it arrive.
 */
export class FixedRangeProfileDrawing implements ChartDrawingShape {
  /** The overlay's state: this drawing's range, its profile and the flags the requester writes. */
  readonly state: FixedRangeProfileState = { range: null, hit: {} };

  private window: FixedRangeProfileRange;
  /** Open time of the window's last slot; undefined while the loaded bars do not place the window. */
  private lastSlotOpenMs: number | undefined;
  private readonly requester: FixedRangeProfileRequester;
  /** The shared queue tells drawings apart by a key of their own; the stored id belongs to the collection. */
  private readonly queueKey = crypto.randomUUID();
  /** Whether the newest bar opened before the window end at the last bar change: its last bar may gain ticks. */
  private wasOpenAtLastBarsChange = false;
  /** The timeframe of the bars `wasOpenAtLastBarsChange` was judged on. */
  private lastTimeframe: string | undefined;
  /** The resolved settings the collection last gave this drawing; the defaults until it does. */
  private settings: FixedRangeProfileSettings = DEFAULT_FIXED_RANGE_PROFILE_SETTINGS;
  /** Whether the collection shows this drawing; a hidden one asks for nothing, so a settings change waits. */
  private shown = false;
  /** Whether the last paint drew the boundary lines and circles; the e2e suite reads it instead of sampling pixels. */
  private handlesPainted = false;

  private constructor(
    private readonly host: ChartToolHost,
    private readonly queue: TickProfileRequestQueue,
    window: FixedRangeProfileRange,
    lastSlotOpenMs: number | undefined,
  ) {
    this.window = { fromMs: window.fromMs, endMs: window.endMs };
    this.lastSlotOpenMs = lastSlotOpenMs;
    this.requester = new FixedRangeProfileRequester(
      host,
      queue.portFor(this.queueKey),
      this.state,
      () => this.window,
      () => this.settings.requestParams,
    );
    this.markPlaced();
  }

  /** A drawing the user just placed: its handle sits on the slot the gesture anchored to. */
  static placed(
    host: ChartToolHost,
    queue: TickProfileRequestQueue,
    range: PlacedFixedRangeProfile,
  ): FixedRangeProfileDrawing {
    return new FixedRangeProfileDrawing(host, queue, range, range.lastSlotOpenMs);
  }

  /** A drawing read back from the app's storage, already validated by the collection and the factory. */
  static restored(
    host: ChartToolHost,
    queue: TickProfileRequestQueue,
    window: FixedRangeProfileRange,
    lastSlotOpenMs: number | undefined,
  ): FixedRangeProfileDrawing {
    return new FixedRangeProfileDrawing(host, queue, window, lastSlotOpenMs);
  }

  /** The pane x of both handles of one range: what a hit test and the two boundary lines measure against. */
  static handleXsFor(geometry: ChartToolGeometry, range: PlacedFixedRangeProfile): HandleEdges {
    return { fromX: geometry.timeToX(range.fromMs), toX: geometry.timeToX(range.lastSlotOpenMs) };
  }

  /**
   * The two dashed boundary lines and their handle circles, painted at the given pane x. A committed
   * drawing calls this only while selected, a half-placed range while its second click is pending.
   */
  static drawHandles(ctx: CanvasRenderingContext2D, viewport: RenderViewport, handles: HandleEdges): void {
    const { height } = viewport.chartRect;
    ctx.strokeStyle = palette.textLabel;
    ctx.lineWidth = 1;
    ctx.setLineDash(HANDLE_DASH_PX);
    for (const x of [handles.fromX, handles.toX]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, height / 2, HANDLE_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = palette.panel;
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash(HANDLE_DASH_PX);
    }
    ctx.setLineDash([]);
  }

  /** The window the profile is requested for: the two anchors the app stores are its edges. */
  points(): ChartDrawingPoint[] {
    return fixedRangeProfilePoints(this.window);
  }

  /** The committed window and where its right-hand handle sits; null until the loaded bars place it. */
  placedRange(): PlacedFixedRangeProfile | null {
    const { lastSlotOpenMs } = this;
    return lastSlotOpenMs === undefined ? null : { ...this.window, lastSlotOpenMs };
  }

  /** Commits a new range: it becomes this drawing's window and its profile is requested again. */
  commitRange(range: PlacedFixedRangeProfile): void {
    this.window = { fromMs: range.fromMs, endMs: range.endMs };
    this.lastSlotOpenMs = range.lastSlotOpenMs;
    this.markPlaced();
    this.requestProfile();
  }

  /** The pane x of both handles of `range`. */
  handleXs(range: PlacedFixedRangeProfile): HandleEdges {
    return FixedRangeProfileDrawing.handleXsFor(this.host.geometry, range);
  }

  /** Which boundary a press at pane x would drag, null when x is not on a handle or the window is unplaced. */
  handleAt(x: number): 'from' | 'end' | null {
    const placed = this.placedRange();
    if (placed === null) {
      return null;
    }
    const { fromX, toX } = this.handleXs(placed);
    if (Math.abs(x - fromX) <= HANDLE_HIT_PX) {
      return 'from';
    }
    return Math.abs(x - toX) <= HANDLE_HIT_PX ? 'end' : null;
  }

  /** Whether the pane point falls between its handles or on one of them: the band this profile covers. */
  contains(x: number, y: number): boolean {
    const placed = this.placedRange();
    if (placed === null || outsidePane(this.host.geometry.viewport().chartRect, x, y)) {
      return false;
    }
    const { fromX, toX } = this.handleXs(placed);
    return this.handleAt(x) !== null || (x >= Math.min(fromX, toX) && x <= Math.max(fromX, toX));
  }

  /**
   * The range a dragged boundary previews at `anchor`, or null when no legal range fits there. A
   * moving boundary stays on a real candle when it crosses the other one: this never synthesizes
   * anchors one millisecond apart.
   */
  boundaryPreview(
    side: 'from' | 'end',
    original: PlacedFixedRangeProfile,
    anchor: BarAnchor,
  ): PlacedFixedRangeProfile | null {
    const { barSeries } = this.host;
    const { bars } = barSeries;
    if (side === 'from') {
      let lastAllowedIndex = bars.length - 1;
      while (lastAllowedIndex >= 0 && bars[lastAllowedIndex].time * 1000 > original.lastSlotOpenMs) {
        lastAllowedIndex -= 1;
      }
      if (lastAllowedIndex < 0) {
        return null;
      }
      const index = Math.min(anchor.index, lastAllowedIndex);
      return { ...original, ...minuteAlignedWindow({ fromMs: bars[index].time * 1000, endMs: original.endMs }) };
    }
    const firstAllowedIndex = bars.findIndex((bar) => bar.time * 1000 >= original.fromMs);
    if (firstAllowedIndex < 0) {
      return null;
    }
    const endAnchor = anchor.index < firstAllowedIndex ? anchorAtBar(barSeries, firstAllowedIndex) : anchor;
    return rangeEndingAtAnchor(barSeries, original.fromMs, endAnchor);
  }

  /** A boundary preview hides the result until the drag is released or cancelled. */
  setPreviewing(previewing: boolean): void {
    this.state.previewing = previewing;
  }

  /** Whether the painted profile answers the committed range rather than a preview. */
  hasProfile(): boolean {
    return this.state.profile !== undefined && !this.state.previewing;
  }

  /** Whether the last paint showed the boundary lines and circles. */
  wereHandlesPainted(): boolean {
    return this.handlesPainted;
  }

  /** This drawing as the e2e suite names it: its window and its result. */
  summary(): FixedRangeProfileDrawingSummary {
    return { range: { fromMs: this.window.fromMs, endMs: this.window.endMs }, hasProfile: this.hasProfile() };
  }

  /**
   * Asks for the profile of the committed window. A drawing the loaded bars do not place yet asks
   * once they do, because a request needs the slot its window ends in.
   */
  requestProfile(): void {
    if (this.lastSlotOpenMs === undefined) {
      this.placeOnBars();
      return;
    }
    this.requester.requestProfile(this.window);
  }

  /**
   * Reported on every change, not only on a new bar, because ticks inside the forming bar belong to
   * the profile too; the requester throttles the refresh. The change in which a bar opens at or
   * after the window end is reported once more, as the final refresh, and later changes are not. The
   * end itself never moves, so the range is re-evaluated against whatever the newest bar is, e.g.
   * after a timeframe switch.
   */
  barsChanged(): void {
    if (this.host.barSeries.bars.length === 0) {
      return;
    }
    if (this.lastSlotOpenMs === undefined) {
      // The bars that place a stored drawing are also the ones it was waiting for.
      this.requestProfile();
      return;
    }
    const wasOpen = this.wasOpenAtLastBarsChange;
    this.wasOpenAtLastBarsChange = this.isOpen();
    const timeframe = this.host.barSeries.timeframe;
    if (timeframe !== this.lastTimeframe) {
      // The profile is timeframe-independent, so "was open" on the previous timeframe's bars is no reason for a
      // final refresh. A request still unsettled is renewed rather than waited for; a loaded profile stays.
      this.lastTimeframe = timeframe;
      this.requester.renewUnsettledRequest(this.window);
      if (this.wasOpenAtLastBarsChange) {
        this.requester.requestThrottledRefresh(this.window);
      }
      return;
    }
    if (wasOpen || this.wasOpenAtLastBarsChange) {
      this.requester.requestThrottledRefresh(this.window);
    }
  }

  draw(ctx: CanvasRenderingContext2D, viewport: RenderViewport, options: FixedRangeProfilePaintOptions): void {
    const placed = options.preview ?? this.placedRange();
    if (placed === null) {
      return;
    }
    // The histogram first, isolated so its style does not leak, then the handles.
    const handles = this.handleXs(placed);
    ctx.save();
    drawFixedRangeProfile(ctx, viewport, this.state, this.settings.appearance, handles);
    ctx.restore();
    // Veil the histogram but not the handles, which stay crisp; the loader goes on top of both.
    drawFixedRangeProfileLoadingWash(ctx, viewport, this.state, handles);
    this.handlesPainted = options.selected;
    if (options.selected) {
      FixedRangeProfileDrawing.drawHandles(ctx, viewport, handles);
    }
    drawFixedRangeProfileSpinner(ctx, viewport, this.state, Date.now(), handles);
  }

  /** Hidden: the drawing stops refreshing and leaves the queue; shown again: it asks for its profile again. */
  visibilityChanged(visible: boolean): void {
    this.shown = visible;
    if (visible) {
      this.requestProfile();
      return;
    }
    this.requester.suspendRequests();
    this.queue.release(this.queueKey);
  }

  /**
   * New resolved settings. Only the ones that shape the computation (rows, value area) ask for a new profile; the
   * request replaces the awaited one and, for this drawing, the load in flight. The rest repaint with the
   * collection's own repaint.
   */
  settingsChanged(inputs: ToolInputValues): void {
    const previous = this.settings.requestParams;
    this.settings = readFixedRangeProfileSettings(inputs);
    if (this.shown && !sameProfileRequestParams(previous, this.settings.requestParams)) {
      this.requestProfile();
    }
  }

  /** The drawing goes away: abandon its request, stop the backend load behind it and stop listening. */
  dispose(): void {
    this.requester.cancelRequest();
    this.requester.dispose();
  }

  /** Records the window and the timeframe whose bars judge whether it may still gain ticks. */
  private markPlaced(): void {
    this.lastTimeframe = this.host.barSeries.timeframe;
    this.wasOpenAtLastBarsChange = this.isOpen();
  }

  /**
   * Places a stored window on the bars loaded now: its right-hand handle needs the slot that holds
   * the window's last instant. Nothing is painted, hit or requested while no bar reaches it.
   */
  private placeOnBars(): void {
    if (this.host.barSeries.bars.length === 0) {
      return;
    }
    const lastSlotOpenMs = lastSlotOpenBefore(this.host.barSeries, this.window.endMs);
    if (lastSlotOpenMs === undefined) {
      return;
    }
    this.lastSlotOpenMs = lastSlotOpenMs;
    this.markPlaced();
    this.requestProfile();
  }

  /** Whether the window may still gain ticks, judged by the newest bar and by the feed's newest quote. */
  private isOpen(): boolean {
    const { currentMarket, barSeries } = this.host;
    const quote = currentMarket.quote();
    const quoteTimeMs =
      quote && quote.symbol === currentMarket.symbol() && Number.isFinite(quote.timeMs) ? quote.timeMs : undefined;
    return isRangeOpen(barSeries, this.window, quoteTimeMs);
  }
}
