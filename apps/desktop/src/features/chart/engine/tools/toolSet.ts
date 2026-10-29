import type { ChartDrawingCommands } from '../drawings/chartDrawings';
import type { ChartDrawingPoint, ChartDrawingRecord, ChartDrawingSelection } from '../drawings/drawingRecord';
import { DrawingRegistry } from '../drawings/drawingRegistry';
import { drawingsAroundBars, type DrawingRef, type DrawingStackEntry } from '../drawings/drawingStack';
import type { DrawingTimeframeVisibility } from '../drawings/timeframeVisibility';
import type { ToolInputValues } from '../drawings/toolInputs';
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
 * The instantiated tools and which one is active. It routes pointer events and lifecycle calls to
 * every tool, paints the drawings in the stacking order and knows no concrete tool: the default id
 * and the definitions come from the app. The drawing commands are answered by the `DrawingRegistry`.
 *
 * The constructor only builds the tools. The default tool becomes active through
 * `activateDefaultTool()`, which the owner calls once it is fully constructed: a tool's
 * `activate` may ask the host to repaint, and the host reaches objects the owner is
 * still creating while the constructor runs.
 */
export class ChartToolSet implements ChartDrawingCommands {
  private activeEntry: ToolEntry;
  /** Where the pointer rests in the pane; replayed to a tool that becomes active later. Null outside it. */
  private hoverPoint: { x: number; y: number } | null = null;
  private readonly entries: readonly ToolEntry[];
  private readonly registry: DrawingRegistry;
  /** The timeframe the last `barsChanged` saw, so a selection is dropped on a switch and not on a live tick. */
  private lastTimeframe: string;

  constructor(
    definitions: readonly ChartToolDefinition[],
    private readonly defaultToolId: string,
    private readonly host: ChartToolHostBase,
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
    this.lastTimeframe = host.barSeries.timeframe;
    this.entries = definitions.map((definition) => ({
      definition,
      tool: resolveTool(new definition.toolClass(this.hostFor(definition.id, host))),
    }));
    this.registry = new DrawingRegistry(
      this.entries.map(({ definition, tool }) => ({ toolId: definition.id, drawings: tool.drawings })),
      () => host.barSeries.timeframe,
      listeners,
    );
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
      this.registry.clearSelection();
    }
  }

  /** Makes the default tool active again without cancelling gestures (a placement just committed). */
  returnToDefaultTool(): void {
    this.switchToTool(this.defaultToolId);
  }

  /**
   * Routes a press to the active tool first, which may start a new drawing, then to every tool so an
   * existing drawing stays editable. A press that selects a drawing only selects it: editing needs a
   * press on an already selected drawing, because its edit handles show only then.
   */
  pointerDown(x: number, y: number): boolean {
    const selectionBefore = this.registry.selectedDrawing();
    this.selectDrawingAt(x, y);
    const active = this.activeEntry.tool;
    const mayEdit = this.registry.selectedDrawing() === selectionBefore;
    return (
      active.pointerDown(x, y, 'startNewDrawing') ||
      (mayEdit && this.tools().some((tool) => tool !== active && tool.pointerDown(x, y, 'editExistingDrawing')))
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
      this.paintDrawings(target, drawingsAroundBars(this.registry.drawingStack()).above);
    }
    for (const tool of this.tools()) {
      this.paintIsolated(target.context, () => tool.draw(target));
    }
  }

  /** The pane pass under the candle series: every drawing stacked below the price bars, bottom to top. */
  drawBelowBars(target: ChartDrawingPaintTarget): void {
    this.paintDrawings(target, drawingsAroundBars(this.registry.drawingStack()).below);
  }

  cancelGestures(): void {
    this.tools().forEach((tool) => tool.cancelGesture());
  }

  selectedDrawing(): ChartDrawingSelection | null {
    return this.registry.selectedDrawing();
  }

  selectDrawing(toolId: string, drawingId: string): void {
    this.registry.selectDrawing(toolId, drawingId);
  }

  deleteDrawing(toolId: string, drawingId: string): boolean {
    return this.registry.deleteDrawing(toolId, drawingId);
  }

  setDrawingLocked(toolId: string, drawingId: string, locked: boolean): void {
    this.registry.setDrawingLocked(toolId, drawingId, locked);
  }

  setDrawingVisible(toolId: string, drawingId: string, visible: boolean): void {
    this.registry.setDrawingVisible(toolId, drawingId, visible);
  }

  setDrawingTimeframeVisibility(toolId: string, drawingId: string, visibility: DrawingTimeframeVisibility): void {
    this.registry.setDrawingTimeframeVisibility(toolId, drawingId, visibility);
  }

  setDrawingInputs(toolId: string, drawingId: string, inputs: ToolInputValues): void {
    this.registry.setDrawingInputs(toolId, drawingId, inputs);
  }

  setDrawingPoints(toolId: string, drawingId: string, points: readonly ChartDrawingPoint[]): boolean {
    return this.registry.setDrawingPoints(toolId, drawingId, points);
  }

  exportDrawings(): ChartDrawingRecord[] {
    return this.registry.exportDrawings();
  }

  replaceDrawings(records: readonly ChartDrawingRecord[]): void {
    this.registry.replaceDrawings(records);
  }

  drawingStack(): readonly DrawingStackEntry[] {
    return this.registry.drawingStack();
  }

  moveStackEntry(fromIndex: number, toIndex: number): boolean {
    return this.registry.moveStackEntry(fromIndex, toIndex);
  }

  /** The bars changed; a switch to another timeframe also drops a selection the new timeframe hides. */
  barsChanged(): void {
    this.tools().forEach((tool) => tool.barsChanged());
    const { timeframe } = this.host.barSeries;
    if (timeframe !== this.lastTimeframe) {
      this.lastTimeframe = timeframe;
      this.registry.dropSelectionIfHiddenHere();
    }
  }

  /** Drops every tool's instrument-, session- or connection-bound state, the drawings and the stacking order. */
  resetTools(reason: ChartToolResetReason): void {
    this.registry.clearSelection();
    this.tools().forEach((tool) => tool.reset(reason));
    this.registry.clearStackAndTimeframes();
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
      drawingShownOnTimeframe: (drawingId) => this.registry.isShownHere({ toolId, drawingId }),
      drawingPlaced: (drawingId) => this.registry.commitDrawing(toolId, drawingId),
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
    this.registry.selectDrawingAt(x, y);
  }

  /** One side of the stacking order, bottom to top, each drawing painted by its own tool and isolated. */
  private paintDrawings(target: ChartDrawingPaintTarget, refs: readonly DrawingRef[]): void {
    for (const { toolId, drawingId } of refs) {
      const tool = this.findEntry(toolId)?.tool;
      // A hidden drawing, or one the current timeframe hides, keeps its place in the order but paints nothing.
      if (tool === undefined || tool.drawings?.isVisible(drawingId) !== true) {
        continue;
      }
      if (!this.registry.isShownHere({ toolId, drawingId })) {
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
