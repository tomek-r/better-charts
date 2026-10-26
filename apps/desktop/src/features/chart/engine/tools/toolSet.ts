import type { ChartDrawingPoint, ChartDrawingRecord, ChartDrawingSelection } from '../drawings/drawingRecord';
import {
  DrawingStack,
  drawingRefs,
  drawingsAroundBars,
  type DrawingRef,
  type DrawingStackEntry,
} from '../drawings/drawingStack';
import { DrawingSelectionState } from '../drawings/drawingSelection';
import type { ToolInputValues } from '../drawings/toolInputs';
import type { ChartToolDrawings } from '../drawings/toolDrawings';
import type {
  ChartDrawingPaintTarget,
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolHostBase,
  ChartToolResetReason,
} from './toolContract';

/**
 * A tool with every optional member defaulted: `resolveTool` is the single place a missing member
 * means a no-op. `drawings` stays undefined when a tool places no drawings, which is how the set
 * knows to skip it.
 */
type ResolvedChartTool = Required<Omit<ChartTool, 'drawings'>> & Pick<ChartTool, 'drawings'>;

/** A registered tool: what the app says about it and the instance the engine built. */
interface ToolEntry {
  readonly definition: ChartToolDefinition;
  readonly tool: ResolvedChartTool;
}

/** The drawing a tool paints as selected, kept so the next selection can clear it first. */
interface DrawingHighlight {
  readonly entry: ToolEntry;
  readonly drawingId: string;
}

/** What the owner of the set hears about: the pane cursor, the selected drawing and the drawn state. */
export interface ChartToolSetListeners {
  cursorChanged(cursor: ChartToolDefinition['cursor']): void;
  selectionChanged(selection: ChartDrawingSelection | null): void;
  drawingsChanged(): void;
}

function resolveTool(tool: ChartTool): ResolvedChartTool {
  return {
    hasGesture: () => tool.hasGesture?.() ?? false,
    activate: () => tool.activate?.(),
    deactivate: () => tool.deactivate?.(),
    pointerDown: (x, y, purpose) => tool.pointerDown?.(x, y, purpose) ?? false,
    pointerMove: (x, y) => tool.pointerMove?.(x, y) ?? false,
    pointerUp: (outcome) => tool.pointerUp?.(outcome) ?? false,
    pointerHover: (x, y) => tool.pointerHover?.(x, y),
    pointerLeave: () => tool.pointerLeave?.(),
    cancelGesture: () => tool.cancelGesture?.(),
    drawings: tool.drawings,
    draw: (target) => tool.draw?.(target),
    drawDrawing: (target, drawingId) => tool.drawDrawing?.(target, drawingId),
    barsChanged: () => tool.barsChanged?.(),
    reset: (reason) => tool.reset?.(reason),
    dispose: () => tool.dispose?.(),
    testApi: () => tool.testApi?.(),
  };
}

/**
 * The instantiated tools, which one is active and which drawing is selected. It routes
 * pointer events, selection changes and lifecycle calls to every tool and knows no concrete
 * tool: the default id and the definitions come from the app.
 *
 * The constructor only builds the tools. The default tool becomes active through
 * `activateDefaultTool()`, which the owner calls once it is fully constructed: a tool's
 * `activate` may ask the host to repaint, and the host reaches objects the owner is
 * still creating while the constructor runs.
 */
export class ChartToolSet {
  private activeEntry: ToolEntry;
  /** Where the pointer rests in the pane; replayed to a tool that becomes active later. Null outside it. */
  private hoverPoint: { x: number; y: number } | null = null;
  private readonly entries: readonly ToolEntry[];
  /** The chart's single stacking order, shared by every tool's drawings. */
  private readonly stack = new DrawingStack();
  /** The selected drawing; the state decides whether a new selection really differs. */
  private readonly selectionState = new DrawingSelectionState((selection) => this.paintSelection(selection));
  private highlight: DrawingHighlight | null = null;

  constructor(
    definitions: readonly ChartToolDefinition[],
    private readonly defaultToolId: string,
    host: ChartToolHostBase,
    private readonly listeners: ChartToolSetListeners,
  ) {
    const ids = new Set<string>();
    for (const { id } of definitions) {
      if (ids.has(id)) {
        throw new Error(`Chart tool id "${id}" is registered more than once`);
      }
      ids.add(id);
    }
    if (!ids.has(defaultToolId)) {
      throw new Error(`Default chart tool "${defaultToolId}" is not registered`);
    }
    this.entries = definitions.map((definition) => ({
      definition,
      tool: resolveTool(new definition.toolClass(this.hostFor(definition.id, host))),
    }));
    this.activeEntry = this.entry(defaultToolId);
  }

  /** Activates the default tool; the owner calls it once, after it has finished constructing. */
  activateDefaultTool(): void {
    this.activeEntry.tool.activate();
    this.listeners.cursorChanged(this.activeEntry.definition.cursor);
  }

  /** Whether a tool that places drawings (not a pointer tool) is active. */
  isPlacementToolActive(): boolean {
    return this.activeEntry.definition.placesDrawings;
  }

  /** Makes a tool the active one after dropping any half-placed drawing; picking the active tool again is a no-op. */
  selectTool(id: string): void {
    const gestures = this.tools().filter((tool) => tool.hasGesture());
    if (id === this.activeEntry.definition.id && gestures.length === 0) {
      return;
    }
    for (const tool of gestures) {
      tool.cancelGesture();
    }
    this.switchToTool(id);
    if (this.entry(id).definition.placesDrawings) {
      this.changeSelection(null);
    }
  }

  /** Makes the default tool active again without cancelling gestures (a placement just committed). */
  returnToDefaultTool(): void {
    this.switchToTool(this.defaultToolId);
  }

  /**
   * Routes a press to the active tool first, which may start a new drawing, then
   * to every tool so an existing drawing stays editable with no tool active.
   * A press that lands on a drawing of a finished tool selects it.
   */
  pointerDown(x: number, y: number): boolean {
    this.selectDrawingAt(x, y);
    const active = this.activeEntry.tool;
    return (
      active.pointerDown(x, y, 'startNewDrawing') ||
      this.tools().some((tool) => tool !== active && tool.pointerDown(x, y, 'editExistingDrawing'))
    );
  }

  pointerMove(x: number, y: number): boolean {
    return this.tools().some((tool) => tool.pointerMove(x, y));
  }

  pointerUp(outcome: ChartPointerUpOutcome): boolean {
    // `map` before `some`: every tool must see the release, so a consuming tool must not short-circuit the rest.
    return this.tools()
      .map((tool) => tool.pointerUp(outcome))
      .some(Boolean);
  }

  /** Every pane pointer move goes to the active tool, independent of `pointerMove` routing. */
  pointerHover(x: number, y: number): void {
    this.hoverPoint = { x, y };
    this.activeEntry.tool.pointerHover(x, y);
  }

  pointerLeave(): void {
    this.hoverPoint = null;
    this.activeEntry.tool.pointerLeave();
  }

  /**
   * One layer pass: every tool, in registry order, each isolated by save/restore so none leaks canvas
   * state. On the pane's below-trading layer the drawings stacked over the price bars paint first, in
   * the chart's order, so they stay under the trading overlays and over the candles.
   */
  draw(target: ChartDrawTarget): void {
    if (target.layer.surface === 'pane' && target.layer.depth === 'belowTradingOverlays') {
      this.paintDrawings(target, drawingsAroundBars(this.stackEntries()).above);
    }
    for (const tool of this.tools()) {
      this.paintIsolated(target.context, () => tool.draw(target));
    }
  }

  /** The pane pass under the candle series: every drawing stacked below the price bars, bottom to top. */
  drawBelowBars(target: ChartDrawingPaintTarget): void {
    this.paintDrawings(target, drawingsAroundBars(this.stackEntries()).below);
  }

  /** The chart's single stacking order, bottom to top, healed against the drawings that really exist. */
  drawingStack(): readonly DrawingStackEntry[] {
    return this.stackEntries();
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
    const entries = this.stackEntries();
    for (const { definition, tool } of this.entries) {
      tool.drawings?.arrange(this.stackedIdsOf(definition.id, entries));
    }
    this.listeners.drawingsChanged();
    return true;
  }

  cancelGestures(): void {
    this.tools().forEach((tool) => tool.cancelGesture());
  }

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
    if (selection === null) {
      return;
    }
    this.changeSelection(selection);
  }

  /** Removes one drawing of any tool, even when it is locked; false when there is no such drawing. */
  deleteDrawing(toolId: string, drawingId: string): boolean {
    if (this.drawingsOf(toolId)?.delete(drawingId) !== true) {
      return false;
    }
    this.selectionState.clearIfDrawing(toolId, drawingId);
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

  /** Every drawing in the chart's stacking order, bottom first, stamped with its tool and its side of the bars. */
  exportDrawings(): ChartDrawingRecord[] {
    const entries = this.stackEntries();
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
    this.changeSelection(null);
    for (const { definition, tool } of this.entries) {
      tool.drawings?.importRecords(records.filter((record) => record.toolId === definition.id));
    }
    this.stack.replace(
      records
        .filter((record) => this.findEntry(record.toolId) !== undefined)
        .map((record) => ({ ref: { toolId: record.toolId, drawingId: record.id }, belowBars: record.belowBars })),
    );
  }

  barsChanged(): void {
    this.tools().forEach((tool) => tool.barsChanged());
  }

  /** Drops every tool's instrument-, session- or connection-bound state, the drawings and the stacking order. */
  resetTools(reason: ChartToolResetReason): void {
    this.changeSelection(null);
    this.tools().forEach((tool) => tool.reset(reason));
    this.stack.clear();
  }

  disposeTools(): void {
    this.tools().forEach((tool) => tool.dispose());
  }

  /** Development builds only: a tool's read-only view of its own state. */
  toolTestApi(id: string): unknown {
    return this.entries.find(({ definition }) => definition.id === id)?.tool.testApi();
  }

  /** The tool's host: what the owner supplies plus the two drawing callbacks of this set. */
  private hostFor(toolId: string, host: ChartToolHostBase): ChartToolHost {
    return {
      ...host,
      drawingPlaced: (drawingId) => this.commitDrawing(toolId, drawingId),
      drawingsChanged: () => this.listeners.drawingsChanged(),
    };
  }

  private tools(): ResolvedChartTool[] {
    return this.entries.map(({ tool }) => tool);
  }

  /**
   * A press with no placement tool active picks the topmost drawing under the pointer, or
   * clears the selection on a miss. While a placement tool is active a press belongs to it,
   * so the selection stays as it was.
   */
  private selectDrawingAt(x: number, y: number): void {
    if (this.activeEntry.definition.placesDrawings) {
      return;
    }
    this.changeSelection(this.hitTestDrawings(x, y));
  }

  /** Every drawing that really exists, in registry order and each tool's own paint order. */
  private existingRefs(): DrawingRef[] {
    return this.entries.flatMap(({ definition, tool }) =>
      (tool.drawings?.drawingIds() ?? []).map((drawingId) => ({ toolId: definition.id, drawingId })),
    );
  }

  /** The chart's one stacking order, healed against the drawings that really exist. */
  private stackEntries(): readonly DrawingStackEntry[] {
    return this.stack.entries(this.existingRefs());
  }

  /** The ids of one tool's drawings in the chart's order, which is the order its collection needs too. */
  private stackedIdsOf(toolId: string, entries: readonly DrawingStackEntry[]): string[] {
    return drawingRefs(entries)
      .filter((ref) => ref.toolId === toolId)
      .map(({ drawingId }) => drawingId);
  }

  /** One side of the stacking order, bottom to top, each drawing painted by its own tool and isolated. */
  private paintDrawings(target: ChartDrawingPaintTarget, refs: readonly DrawingRef[]): void {
    for (const { toolId, drawingId } of refs) {
      const tool = this.findEntry(toolId)?.tool;
      // A hidden drawing keeps its place in the order but paints nothing.
      if (tool === undefined || tool.drawings?.isVisible(drawingId) !== true) {
        continue;
      }
      this.paintIsolated(target.context, () => tool.drawDrawing(target, drawingId));
    }
  }

  /** Runs one paint step with the canvas state saved around it, so no tool leaks styles into the next. */
  private paintIsolated(context: CanvasRenderingContext2D, paint: () => void): void {
    context.save();
    try {
      paint();
    } finally {
      context.restore();
    }
  }

  /** The topmost drawing under a pane point in the chart's stacking order, below-bars drawings included. */
  private hitTestDrawings(x: number, y: number): ChartDrawingSelection | null {
    for (const { toolId, drawingId } of drawingRefs(this.stackEntries()).reverse()) {
      if (this.drawingsOf(toolId)?.hits(drawingId, x, y) === true) {
        return this.selectionFor(toolId, drawingId);
      }
    }
    return null;
  }

  /** One drawing as the app stores it, minus the side of the bars, which only the stacking order knows. */
  private exportedRecord({ toolId, drawingId }: DrawingRef): Omit<ChartDrawingRecord, 'belowBars'> | undefined {
    const record = this.drawingsOf(toolId)
      ?.exportRecords()
      .find(({ id }) => id === drawingId);
    return record === undefined ? undefined : { ...record, toolId };
  }

  /** The selection for one drawing; its flags come from the tool's exported record. */
  private selectionFor(toolId: string, drawingId: string): ChartDrawingSelection | null {
    const record = this.drawingsOf(toolId)
      ?.exportRecords()
      .find((drawing) => drawing.id === drawingId);
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
    this.changeSelection(this.selectionFor(toolId, drawingId));
  }

  /** The drawing operations of one tool; undefined when no such tool is registered or it places no drawings. */
  private drawingsOf(toolId: string): ChartToolDrawings | undefined {
    return this.findEntry(toolId)?.tool.drawings;
  }

  /** A tool committed a new drawing: it becomes the selection and the change is reported for saving. */
  private commitDrawing(toolId: string, drawingId: string): void {
    this.changeSelection(this.selectionFor(toolId, drawingId));
    this.listeners.drawingsChanged();
  }

  /** The one place the selection is asked to change; the state reports it when it really did. */
  private changeSelection(selection: ChartDrawingSelection | null): void {
    this.selectionState.set(selection);
  }

  /** Clears the highlight on the previous drawing, paints the new one and tells the owner. */
  private paintSelection(selection: ChartDrawingSelection | null): void {
    this.highlight?.entry.tool.drawings?.select(null);
    const highlight =
      selection === null ? null : { entry: this.entry(selection.toolId), drawingId: selection.drawingId };
    this.highlight = highlight;
    if (highlight !== null) {
      highlight.entry.tool.drawings?.select(highlight.drawingId);
    }
    this.listeners.selectionChanged(selection);
  }

  /** Switches the active tool: its hooks run and the pane cursor follows. */
  private switchToTool(id: string): void {
    const next = this.entry(id);
    const previous = this.activeEntry.tool;
    previous.pointerLeave();
    previous.deactivate();
    this.activeEntry = next;
    next.tool.activate();
    if (this.hoverPoint !== null) {
      next.tool.pointerHover(this.hoverPoint.x, this.hoverPoint.y);
    }
    this.listeners.cursorChanged(next.definition.cursor);
  }

  /** The tool registered under the id, or undefined: the drawing commands treat an unknown id as a no-op. */
  private findEntry(id: string): ToolEntry | undefined {
    return this.entries.find(({ definition }) => definition.id === id);
  }

  private entry(id: string): ToolEntry {
    const entry = this.findEntry(id);
    if (!entry) {
      throw new Error(`Unknown chart tool "${id}"`);
    }
    return entry;
  }
}
