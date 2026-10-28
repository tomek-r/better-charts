import { ChartDrawingCollection, type ChartDrawingEntry } from '../../chart/engine/drawings/chartDrawingCollection';
import { anchorAtX, type BarAnchor } from '../../chart/engine/tools/barAnchor';
import {
  type ChartDrawingPaintTarget,
  type ChartDrawTarget,
  type ChartPointerDownPurpose,
  type ChartPointerUpOutcome,
  type ChartTool,
  type ChartToolHost,
  type ChartToolResetReason,
} from '../../chart/engine/tools/toolContract';
import { finishBoundaryDrag, moveBoundary, startBoundaryDrag, type BoundaryDrag } from './boundaryDrag';
import { FixedRangeProfileDrawing } from './drawing/fixedRangeProfileDrawing';
import { FixedRangeProfileFactory } from './drawing/fixedRangeProfileFactory';
import { FIXED_RANGE_PROFILE_POINTS } from './drawing/fixedRangeProfilePoints';
import { drawHandles, handleXsFor, outsidePane } from './drawing/handles';
import { TickProfileRequestQueue } from './requests/tickProfileRequestQueue';
import { spanBetweenAnchors, type PlacedFixedRangeProfile } from './fixedRangeProfileRange';
import { FIXED_RANGE_PROFILE_INPUTS, FIXED_RANGE_PROFILE_STYLES } from './settingsSchema';
import { createFixedRangeProfileTestApi, type FixedRangeProfileTestApi } from './testApi';

/**
 * The Fixed Range Volume Profile tool: the two-click gesture, the boundary drag and the drawings it
 * routes them to. The shared collection owns the drawings' ids, paint order, selection, lock,
 * visibility and settings; this class decides which drawing a press addresses, how a range is
 * committed and how a drawing paints, and reports every committed change to the host. The start of a
 * range is always a real bar, the end may sit in the empty area right of the newest bar.
 *
 * The drawings' requests share one queue, because the backend computes a single tick profile at a time.
 */
export class FixedRangeProfileTool implements ChartTool {
  private first: BarAnchor | null = null;
  private hover: BarAnchor | null = null;
  private pressed: BarAnchor | null = null;
  private drag: BoundaryDrag | null = null;
  readonly drawings: ChartDrawingCollection<FixedRangeProfileDrawing>;
  private readonly queue: TickProfileRequestQueue;

  constructor(private readonly host: ChartToolHost) {
    this.queue = new TickProfileRequestQueue(host.marketDataPort);
    this.drawings = new ChartDrawingCollection<FixedRangeProfileDrawing>(
      { inputs: FIXED_RANGE_PROFILE_INPUTS, styles: FIXED_RANGE_PROFILE_STYLES, points: FIXED_RANGE_PROFILE_POINTS },
      new FixedRangeProfileFactory(host, this.queue),
      () => host.requestRepaint(),
    );
  }

  /** Whether a click-drag is mid-gesture, which the owner must cancel on a tool switch. */
  hasGesture(): boolean {
    return this.pressed !== null || this.first !== null || this.drag !== null;
  }

  pointerDown(x: number, y: number, purpose: ChartPointerDownPurpose): boolean {
    if (outsidePane(this.host.geometry.viewport().chartRect, x, y)) {
      return false;
    }
    if (purpose === 'editExistingDrawing') {
      return this.beginBoundaryDrag(x);
    }
    const anchor = anchorAtX(this.host, x);
    if (anchor !== null) {
      this.pressed = anchor;
    }
    this.host.requestRepaint();
    return true;
  }

  pointerMove(x: number): boolean {
    if (this.first !== null) {
      this.hover = anchorAtX(this.host, x) ?? this.hover;
      this.host.requestRepaint();
      return true;
    }
    if (this.drag === null) {
      return false;
    }
    moveBoundary(this.host, this.drag, x);
    return true;
  }

  pointerUp(outcome: ChartPointerUpOutcome): boolean {
    const commit = outcome === 'released';
    if (this.pressed !== null) {
      return this.endPlacementStep(this.pressed, commit);
    }
    const drag = this.drag;
    if (drag === null) {
      return false;
    }
    this.drag = null;
    finishBoundaryDrag(this.host, drag, commit);
    return true;
  }

  cancelGesture(): void {
    this.pointerUp('cancelled');
    this.first = null;
    this.hover = null;
    this.host.requestRepaint();
  }

  /** Places the drawings stored before the bars arrived and keeps the visible open ranges fresh. */
  barsChanged(): void {
    for (const { drawing, visible } of this.drawings.entries()) {
      // A hidden drawing asks for nothing: showing it again is what starts its request. A boundary
      // drag owns its range until it is released or cancelled.
      if (visible && drawing !== this.drag?.drawing) {
        drawing.barsChanged();
      }
    }
  }

  /** Paints the half-placed range; committed drawings paint through `drawDrawing`, in the chart's order. */
  draw({ context, viewport, layer }: ChartDrawTarget): void {
    // The price-axis pass paints nothing: the histogram clips to the pane rect, which
    // that pass shifts entirely off the axis canvas.
    if (layer.surface !== 'pane' || layer.depth !== 'belowTradingOverlays') {
      return;
    }
    this.drawPlacementPreview(context, viewport);
  }

  /** Paints one committed drawing where the chart's stacking order puts it: below the bars or over them. */
  drawDrawing({ context, viewport }: ChartDrawingPaintTarget, drawingId: string): void {
    const entry = this.entryOf(drawingId);
    if (entry === undefined) {
      return;
    }
    const preview = this.drag?.drawing === entry.drawing ? this.drag.preview : undefined;
    entry.drawing.draw(context, viewport, { selected: entry.selected, preview });
  }

  /** Every reason drops the drawings; a symbol change also stops the backend work behind them, with one cancel. */
  reset(reason: ChartToolResetReason): void {
    const hadDrawings = this.drawings.entries().length > 0;
    if (reason === 'symbol' && hadDrawings) {
      this.queue.cancelInFlight();
    }
    // Forgetting the requests first is what keeps dropping the drawings from cancelling one by one.
    this.queue.clear();
    this.drawings.clear();
    this.drag = null;
    this.cancelGesture();
    this.host.requestRepaint();
  }

  dispose(): void {
    // Forgetting the requests first keeps every disposed drawing from sending a cancel of its own.
    this.queue.clear();
    this.drawings.clear();
    this.queue.dispose();
  }

  testApi(): FixedRangeProfileTestApi {
    return createFixedRangeProfileTestApi(this.drawings, () => this.drag);
  }

  private beginBoundaryDrag(x: number): boolean {
    const drag = startBoundaryDrag(this.host, this.drawings, x);
    if (drag === null) {
      return false;
    }
    this.drag = drag;
    this.host.requestRepaint();
    return true;
  }

  private endPlacementStep(anchor: BarAnchor, commit: boolean): boolean {
    this.pressed = null;
    if (commit) {
      const first = this.first;
      if (first === null) {
        this.first = anchor;
        this.hover = anchor;
      } else {
        this.placeDrawing(spanBetweenAnchors(this.host.barSeries, first, anchor));
        this.first = null;
        this.hover = null;
      }
    }
    this.host.requestRepaint();
    return true;
  }

  /** Commits the second click as a new drawing: the collection gives it an id, its settings and a profile request. */
  private placeDrawing(range: PlacedFixedRangeProfile): void {
    const drawingId = this.drawings.add(FixedRangeProfileDrawing.placed(this.host, this.queue, range));
    this.host.returnToDefaultTool();
    this.host.drawingPlaced(drawingId);
  }

  /** The dashed lines and circles of a half-placed range, while the second click is still pending. */
  private drawPlacementPreview(ctx: CanvasRenderingContext2D, viewport: ChartDrawTarget['viewport']): void {
    if (this.first === null || this.hover === null) {
      return;
    }
    const range = spanBetweenAnchors(this.host.barSeries, this.first, this.hover);
    drawHandles(ctx, viewport, handleXsFor(this.host.geometry, range));
  }

  /** The collection entry of one drawing, or undefined when the tool no longer holds that id. */
  private entryOf(drawingId: string): ChartDrawingEntry<FixedRangeProfileDrawing> | undefined {
    return this.drawings.entries().find((entry) => entry.id === drawingId);
  }
}
