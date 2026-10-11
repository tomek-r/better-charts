import type {
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolResetReason,
} from './toolContract';

/** A tool with every optional member defaulted: `resolveTool` is the single place a missing member means a no-op. */
type ResolvedChartTool = Required<ChartTool>;

/** A registered tool: what the app says about it and the instance the engine built. */
interface ToolEntry {
  readonly definition: ChartToolDefinition;
  readonly tool: ResolvedChartTool;
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
    deleteDrawing: () => tool.deleteDrawing?.() ?? false,
    draw: (target) => tool.draw?.(target),
    barsChanged: () => tool.barsChanged?.(),
    reset: (reason) => tool.reset?.(reason),
    dispose: () => tool.dispose?.(),
    testApi: () => tool.testApi?.(),
  };
}

/**
 * The instantiated tools and which one is active. It routes pointer events and
 * lifecycle calls to every tool and knows no concrete tool: the default id and
 * the definitions come from the app.
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

  constructor(
    definitions: readonly ChartToolDefinition[],
    private readonly defaultToolId: string,
    host: ChartToolHost,
    private readonly onCursorChange: (cursor: ChartToolDefinition['cursor']) => void,
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
      tool: resolveTool(new definition.toolClass(host)),
    }));
    this.activeEntry = this.entry(defaultToolId);
  }

  /** Activates the default tool; the owner calls it once, after it has finished constructing. */
  activateDefaultTool(): void {
    this.activeEntry.tool.activate();
    this.onCursorChange(this.activeEntry.definition.cursor);
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
  }

  /** Makes the default tool active again without cancelling gestures (a placement just committed). */
  returnToDefaultTool(): void {
    this.switchToTool(this.defaultToolId);
  }

  /**
   * Routes a press to the active tool first, which may start a new drawing, then
   * to every tool so an existing drawing stays editable with no tool active.
   */
  pointerDown(x: number, y: number): boolean {
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

  /** The Delete key: removes every tool's drawing. */
  deleteDrawings(): boolean {
    // `map` before `some`: the key deletes every tool's drawing, not just the first one found.
    return this.tools()
      .map((tool) => tool.deleteDrawing())
      .some(Boolean);
  }

  barsChanged(): void {
    this.tools().forEach((tool) => tool.barsChanged());
  }

  /** Drops every tool's instrument-, session- or connection-bound state. */
  resetTools(reason: ChartToolResetReason): void {
    this.tools().forEach((tool) => tool.reset(reason));
  }

  disposeTools(): void {
    this.tools().forEach((tool) => tool.dispose());
  }

  /** Development builds only: a tool's read-only view of its own state. */
  toolTestApi(id: string): unknown {
    return this.entries.find(({ definition }) => definition.id === id)?.tool.testApi();
  }

  private tools(): ResolvedChartTool[] {
    return this.entries.map(({ tool }) => tool);
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
    this.onCursorChange(next.definition.cursor);
  }

  private entry(id: string): ToolEntry {
    const entry = this.entries.find(({ definition }) => definition.id === id);
    if (!entry) {
      throw new Error(`Unknown chart tool "${id}"`);
    }
    return entry;
  }
}
