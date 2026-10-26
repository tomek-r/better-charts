import {
  anchorAtX,
  type BarAnchor,
  type ChartDrawTarget,
  type ChartPointerDownPurpose,
  type ChartPointerUpOutcome,
  type ChartTool,
  type ChartToolHost,
  type ChartToolResetReason,
} from '../../chart/engine/tools/toolContract';
import { newChartDrawingId, type ChartToolDrawingRecord } from '../../chart/engine/drawings/drawingRecord';
import {
  resolveToolInputValues,
  type ToolInputDefinition,
  type ToolInputValues,
} from '../../chart/engine/drawings/toolInputs';
import { FixedRangeProfileDrawing } from './drawing/fixedRangeProfileDrawing';
import { readFixedRangeProfilePoints } from './drawing/fixedRangeProfilePoints';
import { TickProfileRequestQueue } from './requests/tickProfileRequestQueue';
import {
  lastSlotOpenBefore,
  sameRange,
  spanBetweenAnchors,
  type FixedRangeProfileRange,
  type PlacedFixedRangeProfile,
} from './range';

/**
 * The FRVP's settings; empty until its inputs are designed. Every drawing still stores resolved
 * values so adding an input later restores old drawings with its default.
 */
export const FIXED_RANGE_PROFILE_INPUTS: readonly ToolInputDefinition[] = [];

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

/**
 * A stored drawing that arrived before the series had bars: the record itself, and the window its
 * points name. Its handle sits on a slot of the bars, so the drawing is only built once they exist.
 */
interface PendingRestore {
  readonly record: ChartToolDrawingRecord;
  readonly window: FixedRangeProfileRange;
}

/** What the e2e suite reads through `window.__chartTest.tool('fixedRangeProfile')` (dev builds only). */
export interface FixedRangeProfileTestApi {
  /** Handle x positions and the range of the shown drawing; null when the tool has no drawing. */
  boundaries(): FixedRangeProfileBoundaries | null;
  /** The shown drawing's requested range and whether its computed profile is loaded and visible. */
  selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
  /** Every drawing, bottom to top. */
  drawings(): Array<{ id: string; locked: boolean; range: { fromMs: number; endMs: number }; hasProfile: boolean }>;
}

/** Whether a pane point lies outside the plot area, where no gesture starts. */
function outsidePane(chartRect: { width: number; height: number }, x: number, y: number): boolean {
  return x < 0 || x > chartRect.width || y < 0 || y > chartRect.height;
}

/**
 * The Fixed Range Volume Profile tool: the two-click gesture, the boundary drag and the drawings it
 * routes them to. Every placed profile is an independent `FixedRangeProfileDrawing` with its own id,
 * settings, overlay and request; this class decides which drawing a press addresses and reports every
 * committed change to the host. The start of a range is always a real bar, the end may sit in the
 * empty area right of the newest bar.
 *
 * The drawings' requests share one queue, because the backend computes a single tick profile at a time.
 */
export class FixedRangeProfileTool implements ChartTool {
  private first: BarAnchor | null = null;
  private hover: BarAnchor | null = null;
  private pressed: BarAnchor | null = null;
  private drag: BoundaryDrag | null = null;
  /** Paint order: the last drawing sits on top and is the first one a hit test finds. */
  private readonly drawings: FixedRangeProfileDrawing[] = [];
  /** Stored drawings that arrived before the series had bars: they are built on the first bar. */
  private awaitingBars: PendingRestore[] = [];
  private selectedId: string | null = null;
  private readonly queue: TickProfileRequestQueue;

  constructor(private readonly host: ChartToolHost) {
    this.queue = new TickProfileRequestQueue(host.marketDataPort);
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

  /** The topmost drawing whose handle or band is under the pane point; the engine selects it, locked or not. */
  drawingAt(x: number, y: number): string | null {
    if (outsidePane(this.host.geometry.viewport().chartRect, x, y)) {
      return null;
    }
    const drawing = this.topmost((candidate) => candidate.handleAt(x) !== null || candidate.contains(x));
    return drawing?.id ?? null;
  }

  setSelectedDrawing(drawingId: string | null): void {
    this.selectedId = drawingId;
    this.host.requestRepaint();
  }

  /** Removes one drawing and stops the backend work behind it; a locked drawing goes too, because the engine decided. */
  deleteDrawing(drawingId: string): boolean {
    const index = this.drawings.findIndex((drawing) => drawing.id === drawingId);
    if (index < 0) {
      return false;
    }
    const [drawing] = this.drawings.splice(index, 1);
    if (this.drag?.drawing === drawing) {
      this.drag = null;
    }
    if (this.selectedId === drawingId) {
      this.selectedId = null;
    }
    drawing.cancelRequest();
    drawing.dispose();
    this.host.requestRepaint();
    return true;
  }

  setDrawingLocked(drawingId: string, locked: boolean): boolean {
    const drawing = this.drawingById(drawingId);
    if (!drawing) {
      return false;
    }
    drawing.locked = locked;
    this.host.requestRepaint();
    return true;
  }

  setDrawingInputs(drawingId: string, inputs: ToolInputValues): boolean {
    const drawing = this.drawingById(drawingId);
    if (!drawing) {
      return false;
    }
    drawing.inputs = resolveToolInputValues(FIXED_RANGE_PROFILE_INPUTS, inputs);
    this.host.requestRepaint();
    return true;
  }

  exportDrawings(): ChartToolDrawingRecord[] {
    // Drawings still waiting for bars are exported exactly as they arrived, so a save triggered
    // from elsewhere never drops them; they and `drawings` are never both filled.
    if (this.awaitingBars.length > 0) {
      return this.awaitingBars.map(({ record }) => record);
    }
    return this.drawings.map((drawing) => drawing.toRecord());
  }

  /** Replaces every drawing with the stored ones, dropping unreadable points; nothing is reported to the host. */
  importDrawings(records: readonly ChartToolDrawingRecord[]): void {
    this.dropEveryDrawing();
    for (const record of records) {
      const window = readFixedRangeProfilePoints(record.points);
      if (!window) {
        continue;
      }
      if (this.host.barSeries.bars.length === 0) {
        this.awaitingBars.push({ record, window });
        continue;
      }
      this.restore(record, window);
    }
    // Every drawing here was imported, so this requests the restored profiles and nothing else.
    this.drawings.forEach((drawing) => drawing.requestProfile());
    this.host.requestRepaint();
  }

  /** Places the drawings imported before the series had bars and requests their profiles. */
  barsChanged(): void {
    this.restoreAwaitingDrawings();
    // A boundary drag owns its range until it is released or cancelled.
    this.drawings.filter((drawing) => drawing !== this.drag?.drawing).forEach((drawing) => drawing.barsChanged());
  }

  draw({ context, viewport, layer }: ChartDrawTarget): void {
    // The price-axis pass paints nothing: the histogram clips to the pane rect, which
    // that pass shifts entirely off the axis canvas.
    if (layer.surface !== 'pane' || layer.depth !== 'belowTradingOverlays') {
      return;
    }
    for (const drawing of this.drawings) {
      const preview = this.drag?.drawing === drawing ? this.drag.preview : undefined;
      drawing.draw(context, viewport, { selected: drawing.id === this.selectedId, preview });
    }
    this.drawPlacementPreview(context, viewport);
  }

  /** Every reason drops the drawings; a symbol change also stops the backend work behind them, with one cancel. */
  reset(reason: ChartToolResetReason): void {
    const hadDrawings = this.drawings.length > 0;
    this.dropEveryDrawing();
    if (reason === 'symbol' && hadDrawings) {
      this.queue.cancelInFlight();
    }
    this.queue.clear();
    this.cancelGesture();
    this.host.requestRepaint();
  }

  dispose(): void {
    this.dropEveryDrawing();
    this.queue.dispose();
  }

  testApi(): FixedRangeProfileTestApi {
    return {
      boundaries: () => this.boundaries(),
      selection: () => this.selection(),
      drawings: () => this.drawings.map((drawing) => drawing.summary()),
    };
  }

  /** A press on a handle starts the drag of the topmost unlocked drawing; a locked one lets the chart pan. */
  private beginBoundaryDrag(x: number): boolean {
    const target = this.unlockedHandleAt(x);
    if (target === null) {
      return false;
    }
    const original = target.drawing.committedRange();
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

  /** Commits the second click as a new drawing: it gets an id, the tool's settings and its profile request. */
  private placeDrawing(range: PlacedFixedRangeProfile): void {
    const drawing = FixedRangeProfileDrawing.placed(this.host, this.queue, {
      id: newChartDrawingId(),
      range,
      inputs: resolveToolInputValues(FIXED_RANGE_PROFILE_INPUTS, undefined),
    });
    this.drawings.push(drawing);
    drawing.commitRange(range);
    this.host.returnToDefaultTool();
    this.host.drawingPlaced(drawing.id);
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

  /** The drawing a hit test or the e2e suite shows: the selected one, else the one painted last. */
  private shownDrawing(): FixedRangeProfileDrawing | undefined {
    const selected = this.selectedId === null ? undefined : this.drawingById(this.selectedId);
    return selected ?? this.drawings.at(-1);
  }

  private boundaries(): FixedRangeProfileBoundaries | null {
    const drawing = this.shownDrawing();
    if (!drawing) {
      return null;
    }
    const preview = this.drag?.drawing === drawing ? this.drag.preview : undefined;
    const range = preview ?? drawing.committedRange();
    return { ...drawing.handleXs(this.host.geometry, range), range: { fromMs: range.fromMs, endMs: range.endMs } };
  }

  private selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean } {
    const drawing = this.shownDrawing();
    const requested = drawing?.state.range;
    const range = requested ? { fromMs: requested.fromMs, toMs: requested.toMs } : null;
    return { range, hasProfile: drawing?.hasProfile() ?? false };
  }

  /** The drawing built from a stored record whose points the tool could read. */
  private restore(
    record: ChartToolDrawingRecord,
    window: FixedRangeProfileRange,
  ): FixedRangeProfileDrawing | undefined {
    const lastSlotOpenMs = lastSlotOpenBefore(this.host.barSeries, window.endMs);
    if (lastSlotOpenMs === undefined) {
      // The window predates the loaded history, so there is no slot to put its handle on.
      return undefined;
    }
    const drawing = FixedRangeProfileDrawing.restored(this.host, this.queue, {
      id: record.id,
      locked: record.locked,
      visible: record.visible,
      inputs: resolveToolInputValues(FIXED_RANGE_PROFILE_INPUTS, record.inputs),
      range: { ...window, lastSlotOpenMs },
    });
    this.drawings.push(drawing);
    return drawing;
  }

  /** Places the drawings that waited for bars, and asks for their profiles now that the slots are known. */
  private restoreAwaitingDrawings(): void {
    if (this.awaitingBars.length === 0 || this.host.barSeries.bars.length === 0) {
      return;
    }
    const awaiting = this.awaitingBars;
    this.awaitingBars = [];
    for (const { record, window } of awaiting) {
      this.restore(record, window)?.requestProfile();
    }
  }

  /** Forgets every drawing, its requests and the selection; the backend is not touched. */
  private dropEveryDrawing(): void {
    for (const drawing of this.drawings) {
      drawing.abandon();
      drawing.dispose();
    }
    this.drawings.length = 0;
    this.awaitingBars = [];
    this.selectedId = null;
    this.drag = null;
  }

  private drawingById(drawingId: string): FixedRangeProfileDrawing | undefined {
    return this.drawings.find((drawing) => drawing.id === drawingId);
  }

  /** The last (topmost) drawing in paint order that matches. */
  private topmost(matches: (drawing: FixedRangeProfileDrawing) => boolean): FixedRangeProfileDrawing | undefined {
    return [...this.drawings].reverse().find(matches);
  }

  /** The topmost unlocked drawing with a handle under the pane x, with the side that press would drag. */
  private unlockedHandleAt(x: number): { drawing: FixedRangeProfileDrawing; side: 'from' | 'end' } | null {
    for (let index = this.drawings.length - 1; index >= 0; index -= 1) {
      const drawing = this.drawings[index];
      const side = drawing.locked ? null : drawing.handleAt(x);
      if (side !== null) {
        return { drawing, side };
      }
    }
    return null;
  }
}
