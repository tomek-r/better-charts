import type { ChartToolDrawingRecord } from '../../../chart/engine/drawings/drawingRecord';
import type { ToolInputValues } from '../../../chart/engine/drawings/toolInputs';
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
import { isRangeOpen, rangeEndingAtAnchor, type PlacedFixedRangeProfile } from '../range';
import { FixedRangeProfileRequester } from '../requests/fixedRangeProfileRequester';
import type { TickProfileRequestQueue } from '../requests/tickProfileRequestQueue';
import { fixedRangeProfileGeometry } from './fixedRangeProfileGeometry';

/** How close to a handle a press or a hit test counts as that handle, in pane CSS px. */
export const HANDLE_HIT_PX = 7;
/** Radius of a handle circle, in pane CSS px. */
const HANDLE_RADIUS_PX = 4;
/** The dash of the two boundary lines: 4 px on, 3 px off. */
const HANDLE_DASH_PX = [4, 3];

/** One drawing's stored fields, already validated on the way in. */
export interface FixedRangeProfileDrawingSpec {
  readonly id: string;
  readonly locked: boolean;
  readonly inputs: ToolInputValues;
  readonly range: PlacedFixedRangeProfile;
}

/** What a fresh placement carries: the tool resolved its settings, the drawing starts unlocked. */
export interface FixedRangeProfilePlacement {
  readonly id: string;
  readonly range: PlacedFixedRangeProfile;
  readonly inputs: ToolInputValues;
}

/** How one drawing paints itself: the selection highlight, and the range a boundary drag previews. */
export interface FixedRangeProfilePaintOptions {
  selected: boolean;
  preview?: PlacedFixedRangeProfile;
}

/** One drawing as the e2e suite reads it: its identity, its lock, its committed range and its painted result. */
export interface FixedRangeProfileDrawingSummary {
  id: string;
  locked: boolean;
  range: { fromMs: number; endMs: number };
  hasProfile: boolean;
}

/**
 * One placed fixed-range volume profile: its committed range, its settings, its overlay state and
 * the request behind it. The tool owns the list and the gestures; a drawing owns everything about
 * itself, so two drawings never share a request, a result or a paint.
 *
 * The two factories are the only ways in: `placed` for a range the user just committed, `restored`
 * for one the app read back from storage.
 */
export class FixedRangeProfileDrawing {
  readonly id: string;
  locked: boolean;
  inputs: ToolInputValues;
  /** The overlay's state: this drawing's range, its profile and the flags the requester and the tool write. */
  readonly state: FixedRangeProfileState = { range: null, hit: {} };

  private range: PlacedFixedRangeProfile;
  private readonly requester: FixedRangeProfileRequester;
  /** Whether the newest bar opened before the range end at the last bar change: its last bar may still gain ticks. */
  private wasOpenAtLastBarsChange = false;
  /** The timeframe of the bars `wasOpenAtLastBarsChange` was judged on. */
  private lastTimeframe: string | undefined;

  private constructor(
    private readonly host: ChartToolHost,
    private readonly queue: TickProfileRequestQueue,
    spec: FixedRangeProfileDrawingSpec,
  ) {
    this.id = spec.id;
    this.locked = spec.locked;
    this.inputs = spec.inputs;
    this.range = spec.range;
    this.requester = new FixedRangeProfileRequester(host, queue.portFor(spec.id), this.state, () => this.range);
  }

  /** A drawing the user just placed: unlocked, with the tool's resolved settings. */
  static placed(
    host: ChartToolHost,
    queue: TickProfileRequestQueue,
    placement: FixedRangeProfilePlacement,
  ): FixedRangeProfileDrawing {
    return new FixedRangeProfileDrawing(host, queue, { ...placement, locked: false });
  }

  /** A drawing read back from the app's storage: its geometry and settings were validated by the caller. */
  static restored(
    host: ChartToolHost,
    queue: TickProfileRequestQueue,
    spec: FixedRangeProfileDrawingSpec,
  ): FixedRangeProfileDrawing {
    const drawing = new FixedRangeProfileDrawing(host, queue, spec);
    // A restored range is open or closed against the bars it arrived with, exactly as a placed one was.
    drawing.markPlaced(spec.range);
    return drawing;
  }

  /** The pane x of both handles of one range: what a hit test and the two boundary lines measure against. */
  static handleXsFor(geometry: ChartToolGeometry, range: PlacedFixedRangeProfile): HandleEdges {
    return { fromX: geometry.timeToX(range.fromMs), toX: geometry.timeToX(range.lastSlotOpenMs) };
  }

  /**
   * The two dashed boundary lines and their handle circles, painted at the given pane x. The
   * selection fills the circles with the accent colour so the picked drawing reads as picked.
   */
  static drawHandles(
    ctx: CanvasRenderingContext2D,
    viewport: RenderViewport,
    handles: HandleEdges,
    options: { selected: boolean },
  ): void {
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
      ctx.fillStyle = options.selected ? palette.accent : palette.panel;
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash(HANDLE_DASH_PX);
    }
    ctx.setLineDash([]);
  }

  /** The committed range: the profile window, and the guard the requester compares its throttled refresh against. */
  committedRange(): PlacedFixedRangeProfile {
    return this.range;
  }

  /** Commits a new range: it becomes this drawing's window and its profile is requested again. */
  commitRange(range: PlacedFixedRangeProfile): void {
    this.range = range;
    this.markPlaced(range);
    this.requestProfile();
  }

  requestProfile(): void {
    this.requester.requestProfile(this.range);
  }

  /** The pane x of both handles, for `range` or, by default, for the committed one. */
  handleXs(geometry: ChartToolGeometry, range: PlacedFixedRangeProfile = this.range): HandleEdges {
    return FixedRangeProfileDrawing.handleXsFor(geometry, range);
  }

  /** Which boundary a press at pane x would drag, null when x is not on a handle. */
  handleAt(x: number): 'from' | 'end' | null {
    const { fromX, toX } = this.handleXs(this.host.geometry);
    if (Math.abs(x - fromX) <= HANDLE_HIT_PX) {
      return 'from';
    }
    return Math.abs(x - toX) <= HANDLE_HIT_PX ? 'end' : null;
  }

  /** Whether pane x lies between the two handles: the band this profile covers. */
  contains(x: number): boolean {
    const { fromX, toX } = this.handleXs(this.host.geometry);
    return x >= Math.min(fromX, toX) && x <= Math.max(fromX, toX);
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
      return { ...original, fromMs: bars[index].time * 1000 };
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

  /** This drawing as the e2e suite names it: its identity, its lock, its committed range and its result. */
  summary(): FixedRangeProfileDrawingSummary {
    const range = this.range;
    return {
      id: this.id,
      locked: this.locked,
      range: { fromMs: range.fromMs, endMs: range.endMs },
      hasProfile: this.hasProfile(),
    };
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
    if (this.host.barSeries.bars.length === 0) {
      return;
    }
    const wasOpen = this.wasOpenAtLastBarsChange;
    this.wasOpenAtLastBarsChange = this.isOpen(this.range);
    const timeframe = this.host.barSeries.timeframe;
    if (timeframe !== this.lastTimeframe) {
      // The profile is timeframe-independent, so "was open" on the previous timeframe's bars is no reason for a
      // final refresh. A request still unsettled is renewed rather than waited for; a loaded profile stays.
      this.lastTimeframe = timeframe;
      this.requester.renewUnsettledRequest(this.range);
      if (this.wasOpenAtLastBarsChange) {
        this.requester.requestThrottledRefresh(this.range);
      }
      return;
    }
    if (wasOpen || this.wasOpenAtLastBarsChange) {
      this.requester.requestThrottledRefresh(this.range);
    }
  }

  draw(ctx: CanvasRenderingContext2D, viewport: RenderViewport, options: FixedRangeProfilePaintOptions): void {
    // The histogram first, isolated so its style does not leak, then the handles.
    ctx.save();
    drawFixedRangeProfile(ctx, viewport, this.state);
    ctx.restore();
    // Veil the histogram but not the handles, which stay crisp; the loader goes on top of both.
    const handles = this.handleXs(this.host.geometry, options.preview ?? this.range);
    drawFixedRangeProfileLoadingWash(ctx, viewport, this.state, handles);
    FixedRangeProfileDrawing.drawHandles(ctx, viewport, handles, { selected: options.selected });
    drawFixedRangeProfileSpinner(ctx, viewport, this.state, Date.now(), handles);
  }

  /** This drawing as the app saves it: no reference into the live state. */
  toRecord(): ChartToolDrawingRecord {
    return { id: this.id, locked: this.locked, inputs: this.inputs, geometry: fixedRangeProfileGeometry(this.range) };
  }

  /** The drawing was deleted: abandon its request and stop the backend work behind it. */
  cancelRequest(): void {
    this.requester.cancelRequest();
  }

  /** The drawing goes away locally: a late result is stale and a waiting request leaves the queue uncancelled. */
  abandon(): void {
    this.requester.abandonPendingRequest();
    this.queue.release(this.id);
  }

  dispose(): void {
    this.requester.dispose();
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
}
