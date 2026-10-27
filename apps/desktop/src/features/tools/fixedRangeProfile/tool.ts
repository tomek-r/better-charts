import { ChartDrawingCollection, type ChartDrawingEntry } from '../../chart/engine/drawings/chartDrawingCollection';
import {
  anchorAtX,
  type BarAnchor,
  type ChartDrawingPaintTarget,
  type ChartDrawTarget,
  type ChartPointerDownPurpose,
  type ChartPointerUpOutcome,
  type ChartTool,
  type ChartToolHost,
  type ChartToolResetReason,
} from '../../chart/engine/tools/toolContract';
import { FixedRangeProfileDrawing, outsidePane } from './drawing/fixedRangeProfileDrawing';
import { FixedRangeProfileFactory } from './drawing/fixedRangeProfileFactory';
import { FIXED_RANGE_PROFILE_POINTS } from './drawing/fixedRangeProfilePoints';
import { TickProfileRequestQueue } from './requests/tickProfileRequestQueue';
import { sameRange, spanBetweenAnchors, type PlacedFixedRangeProfile } from './range';
import { FIXED_RANGE_PROFILE_INPUTS, FIXED_RANGE_PROFILE_STYLES } from './settings';

/**
 * The fixed range volume profile's settings live in `settings.ts`, apart from the drawing and the canvas code, so
 * the dialog and the specs can read them alone. Every drawing stores resolved values, so a setting added later
 * restores old drawings with its default.
 */
export { FIXED_RANGE_PROFILE_INPUTS, FIXED_RANGE_PROFILE_STYLES };

/** Where the two drag handles sit, in pane CSS px, and the range they delimit. */
interface FixedRangeProfileBoundaries {
  fromX: number;
  toX: number;
  range: { fromMs: number; endMs: number };
}

/** The boundary drag in progress: the drawing it edits, which side, and the range it previews. */
interface BoundaryDrag {
  readonly drawing: FixedRangeProfileDrawing;
  readonly side: 'from' | 'end';
  readonly original: PlacedFixedRangeProfile;
  preview: PlacedFixedRangeProfile;
}

/** What the e2e suite reads through `window.__chartTest.tool('fixedRangeProfile')` (dev builds only). */
export interface FixedRangeProfileTestApi {
  /** Handle x positions and the range of the shown drawing; null when the tool has no drawing. */
  boundaries(): FixedRangeProfileBoundaries | null;
  /** The shown drawing's requested range and whether its computed profile is loaded and visible. */
  selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
  /** Every drawing, bottom to top. */
  drawings(): Array<{
    id: string;
    locked: boolean;
    range: { fromMs: number; endMs: number };
    hasProfile: boolean;
  }>;
}

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
    return this.drag === null ? false : this.moveBoundary(this.drag, x);
  }

  pointerUp(outcome: ChartPointerUpOutcome): boolean {
    const commit = outcome === 'released';
    if (this.pressed !== null) {
      return this.endPlacementStep(this.pressed, commit);
    }
    return this.drag === null ? false : this.endBoundaryDrag(this.drag, commit);
  }

  cancelGesture(): void {
    this.pointerUp('cancelled');
    this.first = this.hover = null;
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
    return {
      boundaries: () => this.boundaries(),
      selection: () => this.selection(),
      drawings: () => this.drawings.entries().map(({ id, locked, drawing }) => ({ id, locked, ...drawing.summary() })),
    };
  }

  /** A press on a handle starts the drag of the topmost visible unlocked drawing; a locked one lets the chart pan. */
  private beginBoundaryDrag(x: number): boolean {
    const target = this.unlockedHandleAt(x);
    const original = target?.drawing.placedRange() ?? null;
    if (target === null || original === null) {
      return false;
    }
    this.drag = { drawing: target.drawing, side: target.side, original, preview: original };
    this.host.requestRepaint();
    return true;
  }

  private endPlacementStep(anchor: BarAnchor, commit: boolean): boolean {
    this.pressed = null;
    if (commit) {
      const first = this.first;
      if (first === null) {
        this.first = this.hover = anchor;
      } else {
        this.placeDrawing(spanBetweenAnchors(this.host.barSeries, first, anchor));
        this.first = this.hover = null;
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

  private moveBoundary(drag: BoundaryDrag, x: number): boolean {
    const anchor = anchorAtX(this.host, x);
    const preview = anchor === null ? null : drag.drawing.boundaryPreview(drag.side, drag.original, anchor);
    if (preview === null) {
      return true;
    }
    drag.preview = preview;
    drag.drawing.setPreviewing(!sameRange(preview, drag.original));
    this.host.requestRepaint();
    return true;
  }

  private endBoundaryDrag(drag: BoundaryDrag, commit: boolean): boolean {
    this.drag = null;
    drag.drawing.setPreviewing(false);
    if (commit && !sameRange(drag.original, drag.preview)) {
      drag.drawing.commitRange(drag.preview);
      this.host.drawingsChanged();
    }
    this.host.requestRepaint();
    return true;
  }

  /** The dashed lines and circles of a half-placed range, while the second click is still pending. */
  private drawPlacementPreview(ctx: CanvasRenderingContext2D, viewport: ChartDrawTarget['viewport']): void {
    if (this.first === null || this.hover === null) {
      return;
    }
    const range = spanBetweenAnchors(this.host.barSeries, this.first, this.hover);
    const handles = FixedRangeProfileDrawing.handleXsFor(this.host.geometry, range);
    FixedRangeProfileDrawing.drawHandles(ctx, viewport, handles, { selected: false });
  }

  /** The collection entry of one drawing, or undefined when the tool no longer holds that id. */
  private entryOf(drawingId: string): ChartDrawingEntry<FixedRangeProfileDrawing> | undefined {
    return this.drawings.entries().find((entry) => entry.id === drawingId);
  }

  /** The drawing a hit test or the e2e suite shows: the selected one, else the one painted last. */
  private shownDrawing(): FixedRangeProfileDrawing | undefined {
    const entries = this.drawings.entries();
    return (entries.find((entry) => entry.selected) ?? entries.at(-1))?.drawing;
  }

  private boundaries(): FixedRangeProfileBoundaries | null {
    const drawing = this.shownDrawing();
    const placed = drawing?.placedRange() ?? null;
    if (drawing === undefined || placed === null) {
      return null;
    }
    const range = this.drag?.drawing === drawing ? this.drag.preview : placed;
    return { ...drawing.handleXs(range), range: { fromMs: range.fromMs, endMs: range.endMs } };
  }

  private selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean } {
    const drawing = this.shownDrawing();
    const requested = drawing?.state.range;
    const range = requested ? { fromMs: requested.fromMs, toMs: requested.toMs } : null;
    return { range, hasProfile: drawing?.hasProfile() ?? false };
  }

  /** The topmost visible unlocked drawing with a handle under the pane x, with the side that press would drag. */
  private unlockedHandleAt(x: number): { drawing: FixedRangeProfileDrawing; side: 'from' | 'end' } | null {
    const entries = this.drawings.entries();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { id, drawing, locked, visible } = entries[index];
      const grabbable = !locked && visible && this.host.drawingShownOnTimeframe(id);
      const side = grabbable ? drawing.handleAt(x) : null;
      if (side !== null) {
        return { drawing, side };
      }
    }
    return null;
  }
}
