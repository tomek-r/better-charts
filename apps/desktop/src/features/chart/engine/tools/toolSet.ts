import type { ChartDrawingRecord, ChartDrawingSelection } from '../drawings/drawingRecord';
import { DrawingSelectionState } from '../drawings/drawingSelection';
import type { ToolInputValues } from '../drawings/toolInputs';
import type {
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolHostBase,
  ChartToolResetReason,
} from './toolContract';

/** A tool with every optional member defaulted: `resolveTool` is the single place a missing member means a no-op. */
type ResolvedChartTool = Required<ChartTool>;

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
    drawingAt: (x, y) => tool.drawingAt?.(x, y) ?? null,
    setSelectedDrawing: (drawingId) => tool.setSelectedDrawing?.(drawingId),
    setDrawingLocked: (drawingId, locked) => tool.setDrawingLocked?.(drawingId, locked) ?? false,
    setDrawingInputs: (drawingId, inputs) => tool.setDrawingInputs?.(drawingId, inputs) ?? false,
    deleteDrawing: (drawingId) => tool.deleteDrawing?.(drawingId) ?? false,
    exportDrawings: () => tool.exportDrawings?.() ?? [],
    importDrawings: (records) => tool.importDrawings?.(records),
    draw: (target) => tool.draw?.(target),
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

  /** One layer pass: every tool, in registry order, each isolated by save/restore so none leaks canvas state. */
  draw(target: ChartDrawTarget): void {
    const { context } = target;
    for (const tool of this.tools()) {
      context.save();
      try {
        tool.draw(target);
      } finally {
        context.restore();
      }
    }
  }

  cancelGestures(): void {
    this.tools().forEach((tool) => tool.cancelGesture());
  }

  /** The drawing the user has selected, or null. */
  selectedDrawing(): ChartDrawingSelection | null {
    return this.selectionState.current();
  }

  /** The Delete key: removes the selected drawing even when it is locked; false when nothing is selected. */
  deleteSelectedDrawing(): boolean {
    const selection = this.selectionState.current();
    if (selection === null) {
      return false;
    }
    if (!this.entry(selection.toolId).tool.deleteDrawing(selection.drawingId)) {
      return false;
    }
    this.selectionState.clearIfDrawing(selection.toolId, selection.drawingId);
    this.listeners.drawingsChanged();
    return true;
  }

  /** Locks or unlocks the selected drawing, which then ignores edit gestures or accepts them again. */
  setSelectedDrawingLocked(locked: boolean): void {
    const selection = this.selectionState.current();
    if (selection === null) {
      return;
    }
    if (!this.entry(selection.toolId).tool.setDrawingLocked(selection.drawingId, locked)) {
      return;
    }
    this.changeSelection({ ...selection, locked });
    this.listeners.drawingsChanged();
  }

  /** Applies new settings to one drawing; the owner saves when the tool accepted them. */
  setDrawingInputs(toolId: string, drawingId: string, inputs: ToolInputValues): void {
    if (this.entry(toolId).tool.setDrawingInputs(drawingId, inputs)) {
      this.listeners.drawingsChanged();
    }
  }

  /** Every tool's drawings in registry order, each stamped with the tool that owns it. */
  exportDrawings(): ChartDrawingRecord[] {
    return this.entries.flatMap(({ definition, tool }) =>
      tool.exportDrawings().map((record) => ({ ...record, toolId: definition.id })),
    );
  }

  /** Replaces every tool's drawings; records of unknown tool ids are dropped, and nothing is reported. */
  replaceDrawings(records: readonly ChartDrawingRecord[]): void {
    this.changeSelection(null);
    for (const { definition, tool } of this.entries) {
      tool.importDrawings(records.filter((record) => record.toolId === definition.id));
    }
  }

  barsChanged(): void {
    this.tools().forEach((tool) => tool.barsChanged());
  }

  /** Drops every tool's instrument-, session- or connection-bound state, and the selection with it. */
  resetTools(reason: ChartToolResetReason): void {
    this.changeSelection(null);
    this.tools().forEach((tool) => tool.reset(reason));
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

  /** The topmost drawing under a pane point: tools painted later sit above, so the registry is walked backwards. */
  private hitTestDrawings(x: number, y: number): ChartDrawingSelection | null {
    for (const { definition, tool } of this.entries.slice().reverse()) {
      const drawingId = tool.drawingAt(x, y);
      if (drawingId !== null) {
        return this.selectionFor(definition.id, drawingId);
      }
    }
    return null;
  }

  /** The selection for one drawing; its lock flag comes from the tool's exported record. */
  private selectionFor(toolId: string, drawingId: string): ChartDrawingSelection | null {
    const record = this.entry(toolId)
      .tool.exportDrawings()
      .find((drawing) => drawing.id === drawingId);
    return record === undefined ? null : { toolId, drawingId, locked: record.locked };
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
    this.highlight?.entry.tool.setSelectedDrawing(null);
    const highlight =
      selection === null ? null : { entry: this.entry(selection.toolId), drawingId: selection.drawingId };
    this.highlight = highlight;
    if (highlight !== null) {
      highlight.entry.tool.setSelectedDrawing(highlight.drawingId);
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

  private entry(id: string): ToolEntry {
    const entry = this.entries.find(({ definition }) => definition.id === id);
    if (!entry) {
      throw new Error(`Unknown chart tool "${id}"`);
    }
    return entry;
  }
}
