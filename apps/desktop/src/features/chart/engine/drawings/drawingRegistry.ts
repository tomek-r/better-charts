import type { ChartDrawingCommands } from './chartDrawings';
import type {
  ChartDrawingPoint,
  ChartDrawingRecord,
  ChartDrawingSelection,
  ChartToolDrawingRecord,
} from './drawingRecord';
import { DrawingSelectionState } from './drawingSelection';
import { DrawingStack, drawingRefs, type DrawingRef, type DrawingStackEntry } from './drawingStack';
import type { DrawingTimeframeVisibility } from './timeframeVisibility';
import { TimeframeVisibilityStore } from './timeframeVisibilityStore';
import type { ToolInputValues } from './toolInputs';
import type { ChartToolDrawings } from './toolDrawings';

/** One registered tool as the registry sees it: its id and, when it places drawings, their operations. */
export interface DrawingSource {
  readonly toolId: string;
  readonly drawings: ChartToolDrawings | undefined;
}

/** What the owner of the registry hears about: the painted selection and the changed drawing set. */
export interface DrawingRegistryListeners {
  selectionChanged(selection: ChartDrawingSelection | null): void;
  drawingsChanged(): void;
}

/** The drawing a tool paints as selected, kept so the next selection can clear it first. */
interface DrawingHighlight {
  readonly source: DrawingSource;
  readonly drawingId: string;
}

/**
 * Every drawing of every tool as one set: the selection, the user's commands on a drawing, the single
 * stacking order, the timeframes each drawing paints on, and the records the app saves. It knows the
 * tools only through their drawing operations; which tool is active and how pointers route stay with
 * the tool set.
 */
export class DrawingRegistry implements ChartDrawingCommands {
  /** The chart's single stacking order, shared by every tool's drawings. */
  private readonly stack = new DrawingStack();
  /** The selected drawing; the state decides whether a new selection really differs. */
  private readonly selectionState = new DrawingSelectionState((selection) => this.paintSelection(selection));
  private highlight: DrawingHighlight | null = null;
  /** On which timeframes each drawing paints; the tools never see it, only the paint and hit passes do. */
  private readonly timeframeVisibility = new TimeframeVisibilityStore();

  constructor(
    private readonly sources: readonly DrawingSource[],
    private readonly currentTimeframe: () => string,
    private readonly listeners: DrawingRegistryListeners,
  ) {}

  /** The drawing the user has selected, or null. */
  selectedDrawing(): ChartDrawingSelection | null {
    return this.selectionState.current();
  }

  /**
   * Selects one drawing of any tool, hidden or not, which is what the object tree asks for.
   * An unknown tool or drawing leaves the selection exactly as it was.
   */
  selectDrawing(toolId: string, drawingId: string): void {
    const selection = this.selectionFor(toolId, drawingId);
    if (selection !== null) {
      this.selectionState.set(selection);
    }
  }

  clearSelection(): void {
    this.selectionState.set(null);
  }

  /** Picks the topmost drawing under a pane point, or clears the selection on a miss. */
  selectDrawingAt(x: number, y: number): void {
    this.selectionState.set(this.hitTestDrawings(x, y));
  }

  /** A tool committed a new drawing: it becomes the selection and the change is reported for saving. */
  commitDrawing(toolId: string, drawingId: string): void {
    this.selectionState.set(this.selectionFor(toolId, drawingId));
    this.listeners.drawingsChanged();
  }

  /** Removes one drawing of any tool, even when it is locked; false when there is no such drawing. */
  deleteDrawing(toolId: string, drawingId: string): boolean {
    if (this.drawingsOf(toolId)?.delete(drawingId) !== true) {
      return false;
    }
    this.selectionState.clearIfDrawing(toolId, drawingId);
    this.timeframeVisibility.remove({ toolId, drawingId });
    this.listeners.drawingsChanged();
    return true;
  }

  /** Locks or unlocks one drawing of any tool, which then ignores edit gestures or accepts them again. */
  setDrawingLocked(toolId: string, drawingId: string, locked: boolean): void {
    if (this.drawingsOf(toolId)?.setLocked(drawingId, locked) !== true) {
      return;
    }
    this.refreshSelectionOf(toolId, drawingId);
    this.listeners.drawingsChanged();
  }

  /** Hides or shows one drawing; hiding the selected drawing drops the selection with it. */
  setDrawingVisible(toolId: string, drawingId: string, visible: boolean): void {
    if (this.drawingsOf(toolId)?.setVisible(drawingId, visible) !== true) {
      return;
    }
    if (!visible) {
      this.selectionState.clearIfDrawing(toolId, drawingId);
    }
    // A shown drawing can still be the selection, so its flags are re-read for the toolbar.
    this.refreshSelectionOf(toolId, drawingId);
    this.listeners.drawingsChanged();
  }

  /**
   * Sets on which timeframes one drawing paints, reported once for saving. A drawing the new setting hides
   * on the current timeframe loses the selection, like a hidden one; an unknown drawing changes nothing.
   */
  setDrawingTimeframeVisibility(toolId: string, drawingId: string, visibility: DrawingTimeframeVisibility): void {
    if (this.selectionFor(toolId, drawingId) === null) {
      return;
    }
    this.timeframeVisibility.set({ toolId, drawingId }, visibility);
    this.dropSelectionIfHiddenHere();
    this.listeners.drawingsChanged();
  }

  /** Applies new settings to one drawing; the owner saves when the tool accepted them. */
  setDrawingInputs(toolId: string, drawingId: string, inputs: ToolInputValues): void {
    if (this.drawingsOf(toolId)?.setInputs(drawingId, inputs) === true) {
      this.listeners.drawingsChanged();
    }
  }

  /** Moves one drawing to new anchors; answers whether the tool accepted them, and only then reports a change. */
  setDrawingPoints(toolId: string, drawingId: string, points: readonly ChartDrawingPoint[]): boolean {
    if (this.drawingsOf(toolId)?.setPoints(drawingId, points) !== true) {
      return false;
    }
    this.refreshSelectionOf(toolId, drawingId);
    this.listeners.drawingsChanged();
    return true;
  }

  /** The chart's single stacking order, bottom to top, healed against the drawings that really exist. */
  drawingStack(): readonly DrawingStackEntry[] {
    return this.stack.entries(this.existingRefs());
  }

  /**
   * Moves one entry of the stacking order, both indexes bottom first, and answers whether it moved.
   * Every tool reorders its own drawings to match, so a press grabs the same drawing the user saw on
   * top, and the move is reported once for saving.
   */
  moveStackEntry(fromIndex: number, toIndex: number): boolean {
    if (!this.stack.move(fromIndex, toIndex)) {
      return false;
    }
    const entries = this.drawingStack();
    for (const { toolId, drawings } of this.sources) {
      drawings?.arrange(this.stackedIdsOf(toolId, entries));
    }
    this.listeners.drawingsChanged();
    return true;
  }

  /** Every drawing in the chart's stacking order, bottom first, stamped with its tool and its side of the bars. */
  exportDrawings(): ChartDrawingRecord[] {
    const entries = this.drawingStack();
    const markerIndex = entries.findIndex((entry) => entry.kind === 'bars');
    const records: ChartDrawingRecord[] = [];
    for (const [index, entry] of entries.entries()) {
      const record = entry.kind === 'drawing' ? this.exportedRecord(entry.ref) : undefined;
      if (record !== undefined) {
        records.push({ ...record, belowBars: index < markerIndex });
      }
    }
    return records;
  }

  /** Replaces every tool's drawings and the order they stack in; records of unknown tool ids are dropped. */
  replaceDrawings(records: readonly ChartDrawingRecord[]): void {
    this.selectionState.set(null);
    for (const { toolId, drawings } of this.sources) {
      drawings?.importRecords(records.filter((record) => record.toolId === toolId));
    }
    this.timeframeVisibility.replace(records);
    this.stack.replace(
      records
        .filter((record) => this.findSource(record.toolId) !== undefined)
        .map((record) => ({ ref: { toolId: record.toolId, drawingId: record.id }, belowBars: record.belowBars })),
    );
  }

  /** Drops the stacking order and the timeframe settings; the tools drop their own drawings. */
  clearStackAndTimeframes(): void {
    this.stack.clear();
    this.timeframeVisibility.clear();
  }

  /** Whether the drawing's timeframe setting lets it paint and be hit on the chart's current timeframe. */
  isShownHere(ref: DrawingRef): boolean {
    return this.timeframeVisibility.isShown(ref, this.currentTimeframe());
  }

  /** A selection the current timeframe hides is dropped, as hiding the drawing outright drops it. */
  dropSelectionIfHiddenHere(): void {
    const selection = this.selectionState.current();
    if (selection !== null && !this.isShownHere({ toolId: selection.toolId, drawingId: selection.drawingId })) {
      this.selectionState.set(null);
    }
  }

  /** Every drawing that really exists, in registry order and each tool's own paint order. */
  private existingRefs(): DrawingRef[] {
    return this.sources.flatMap(({ toolId, drawings }) =>
      (drawings?.drawingIds() ?? []).map((drawingId) => ({ toolId, drawingId })),
    );
  }

  /** The ids of one tool's drawings in the chart's order, which is the order its collection needs too. */
  private stackedIdsOf(toolId: string, entries: readonly DrawingStackEntry[]): string[] {
    return drawingRefs(entries)
      .filter((ref) => ref.toolId === toolId)
      .map(({ drawingId }) => drawingId);
  }

  /** The topmost drawing under a pane point in the chart's stacking order, below-bars drawings included. */
  private hitTestDrawings(x: number, y: number): ChartDrawingSelection | null {
    for (const ref of drawingRefs(this.drawingStack()).reverse()) {
      const { toolId, drawingId } = ref;
      if (this.isShownHere(ref) && this.drawingsOf(toolId)?.hits(drawingId, x, y) === true) {
        return this.selectionFor(toolId, drawingId);
      }
    }
    return null;
  }

  /** One drawing as its tool exports it; undefined when the tool is unknown or has no such drawing. */
  private recordOf(toolId: string, drawingId: string): ChartToolDrawingRecord | undefined {
    return this.drawingsOf(toolId)
      ?.exportRecords()
      .find(({ id }) => id === drawingId);
  }

  /** One drawing as the app stores it, minus the side of the bars, which only the stacking order knows. */
  private exportedRecord(ref: DrawingRef): Omit<ChartDrawingRecord, 'belowBars'> | undefined {
    const { toolId, drawingId } = ref;
    const record = this.recordOf(toolId, drawingId);
    return record === undefined
      ? undefined
      : { ...record, toolId, timeframeVisibility: this.timeframeVisibility.of(ref) };
  }

  /** The selection for one drawing; its flags come from the tool's exported record. */
  private selectionFor(toolId: string, drawingId: string): ChartDrawingSelection | null {
    const record = this.recordOf(toolId, drawingId);
    return record === undefined ? null : { toolId, drawingId, locked: record.locked, visible: record.visible };
  }

  /**
   * Re-reads the selection of one drawing after its flags changed, so a toolbar shows the new lock or
   * visibility; a selection of another drawing, or no selection, stays untouched.
   */
  private refreshSelectionOf(toolId: string, drawingId: string): void {
    const selection = this.selectionState.current();
    if (selection === null || selection.toolId !== toolId || selection.drawingId !== drawingId) {
      return;
    }
    this.selectionState.set(this.selectionFor(toolId, drawingId));
  }

  /** Clears the highlight on the previous drawing, paints the new one and tells the owner. */
  private paintSelection(selection: ChartDrawingSelection | null): void {
    this.highlight?.source.drawings?.select(null);
    const highlight =
      selection === null ? null : { source: this.sourceOf(selection.toolId), drawingId: selection.drawingId };
    this.highlight = highlight;
    if (highlight !== null) {
      highlight.source.drawings?.select(highlight.drawingId);
    }
    this.listeners.selectionChanged(selection);
  }

  /** The drawing operations of one tool; undefined when no such tool is registered or it places no drawings. */
  private drawingsOf(toolId: string): ChartToolDrawings | undefined {
    return this.findSource(toolId)?.drawings;
  }

  private findSource(toolId: string): DrawingSource | undefined {
    return this.sources.find((source) => source.toolId === toolId);
  }

  private sourceOf(toolId: string): DrawingSource {
    const source = this.findSource(toolId);
    if (!source) {
      throw new Error(`Unknown chart tool "${toolId}"`);
    }
    return source;
  }
}
