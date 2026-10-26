import type { ChartDrawingPoint, ChartDrawingRecord, ChartDrawingSelection } from './drawingRecord';
import type { ToolInputValues } from './toolInputs';
import type { ChartToolSet } from '../tools/toolSet';

/** The drawing commands the class needs: the tool set's drawing API, not the whole set. */
export type ChartDrawingCommands = Pick<
  ChartToolSet,
  | 'selectedDrawing'
  | 'selectDrawing'
  | 'deleteDrawing'
  | 'setDrawingLocked'
  | 'setDrawingVisible'
  | 'setDrawingInputs'
  | 'setDrawingPoints'
  | 'exportDrawings'
  | 'replaceDrawings'
  | 'drawingStack'
  | 'moveStackEntry'
>;

/**
 * One row of the object tree: a drawing with its saved record, or the price bars the drawings above
 * and below it stack around.
 */
export type ChartLayerEntry =
  { readonly kind: 'drawing'; readonly record: ChartDrawingRecord } | { readonly kind: 'bars' };

/** The bars row, shared: it carries no state, so one object serves every list. */
const BARS_LAYER_ENTRY: ChartLayerEntry = { kind: 'bars' };

/** The listeners of one event: adding one answers the function that removes it again. */
class Listeners<Args extends unknown[]> {
  private readonly listeners = new Set<(...args: Args) => void>();

  add(listener: (...args: Args) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(...args: Args): void {
    // A listener may unsubscribe while it runs, so the loop runs over the listeners as they were.
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }
}

/**
 * The chart's drawings as the app sees them: the selection, the user's commands on it, the layering
 * of the drawings around the price bars, and the saved records. Every command that changes what is
 * painted repaints, and every change of the drawing set drops the cached list an object tree reads.
 */
export class ChartDrawings {
  private readonly selectionListeners = new Listeners<[ChartDrawingSelection | null]>();
  private readonly changeListeners = new Listeners<[]>();
  private readonly layerListeners = new Listeners<[]>();
  /** The list handed out until the drawings may have changed: an external store compares snapshots by identity. */
  private cachedLayerList: readonly ChartLayerEntry[] | null = null;

  constructor(
    private readonly commands: ChartDrawingCommands,
    private readonly repaint: () => void,
  ) {}

  /**
   * The user picked another drawing or cleared the selection; null means nothing is selected.
   * Answers the function that stops listening again.
   */
  subscribeSelection(listener: (selection: ChartDrawingSelection | null) => void): () => void {
    return this.selectionListeners.add(listener);
  }

  /**
   * A committed drawing was created, edited, deleted or restacked: the app saves the drawing set
   * again. Answers the function that stops listening again.
   */
  subscribeChanges(listener: () => void): () => void {
    return this.changeListeners.add(listener);
  }

  /**
   * The layer list is about to read differently, so an object tree re-reads it. Answers the
   * function that stops listening again.
   */
  subscribeLayerList(listener: () => void): () => void {
    return this.layerListeners.add(listener);
  }

  /** The tool set reports the selection it painted: repaint it, then let the app hear about it. */
  selectionChanged(selection: ChartDrawingSelection | null): void {
    this.repaint();
    this.selectionListeners.emit(selection);
  }

  /** A drawing changed through the chart: the app saves the set again and the layer list is re-read. */
  drawingsChanged(): void {
    this.invalidateLayerList();
    this.changeListeners.emit();
  }

  /** The drawing set was replaced wholesale (an import, a reset): the list is re-read, but nothing is saved. */
  drawingsReplaced(): void {
    this.invalidateLayerList();
  }

  /** The drawing the user has selected, or null. */
  selected(): ChartDrawingSelection | null {
    return this.commands.selectedDrawing();
  }

  /**
   * Every layer of the chart, topmost first, which is the order an object tree prints them in: the
   * drawings around the price bars, each with its saved record. The same array until the drawings
   * change, because an external store compares snapshots by identity.
   */
  layerList(): readonly ChartLayerEntry[] {
    const cached = this.cachedLayerList;
    if (cached !== null) {
      return cached;
    }
    const layers = this.buildLayerList();
    this.cachedLayerList = layers;
    return layers;
  }

  /** Selects one drawing of any tool, hidden or not, as a click in the object tree does. */
  select(toolId: string, drawingId: string): void {
    this.commands.selectDrawing(toolId, drawingId);
    this.repaint();
  }

  /** Removes one drawing of any tool, even when it is locked; false when it removed nothing. */
  delete(toolId: string, drawingId: string): boolean {
    if (!this.commands.deleteDrawing(toolId, drawingId)) {
      return false;
    }
    this.repaint();
    return true;
  }

  /** Removes the selected drawing only, even when it is locked; false when nothing is selected. */
  deleteSelected(): boolean {
    const selection = this.selected();
    return selection !== null && this.delete(selection.toolId, selection.drawingId);
  }

  /** Locks or unlocks one drawing of any tool, which then ignores edit gestures or accepts them again. */
  setLocked(toolId: string, drawingId: string, locked: boolean): void {
    this.commands.setDrawingLocked(toolId, drawingId, locked);
    this.repaint();
  }

  /** Locks or unlocks the selected drawing, which then ignores edit gestures or accepts them again. */
  setSelectedLocked(locked: boolean): void {
    const selection = this.selected();
    if (selection !== null) {
      this.setLocked(selection.toolId, selection.drawingId, locked);
    }
  }

  /** Hides or shows one drawing of any tool; a hidden drawing is neither painted nor hit. */
  setVisible(toolId: string, drawingId: string, visible: boolean): void {
    this.commands.setDrawingVisible(toolId, drawingId, visible);
    this.repaint();
  }

  setInputs(toolId: string, drawingId: string, inputs: ToolInputValues): void {
    this.commands.setDrawingInputs(toolId, drawingId, inputs);
    this.repaint();
  }

  /** Moves one drawing of any tool to new anchors; false when it has no such drawing or refuses them. */
  setPoints(toolId: string, drawingId: string, points: readonly ChartDrawingPoint[]): boolean {
    const accepted = this.commands.setDrawingPoints(toolId, drawingId, points);
    this.repaint();
    return accepted;
  }

  /**
   * Moves one row of the topmost-first list, which is what an object tree drags. The stack counts
   * bottom first, so both indexes are mirrored before the move; nothing repaints when it did not move.
   */
  moveLayer(fromListIndex: number, toListIndex: number): void {
    const layerCount = this.commands.drawingStack().length;
    if (this.commands.moveStackEntry(layerCount - 1 - fromListIndex, layerCount - 1 - toListIndex)) {
      this.repaint();
    }
  }

  exportRecords(): ChartDrawingRecord[] {
    return this.commands.exportDrawings();
  }

  replaceRecords(records: readonly ChartDrawingRecord[]): void {
    this.commands.replaceDrawings(records);
    this.invalidateLayerList();
    this.repaint();
  }

  /** The stack from the top down, each drawing entry carrying the record the app saved for it. */
  private buildLayerList(): readonly ChartLayerEntry[] {
    const records = this.exportRecords();
    const topFirst = [...this.commands.drawingStack()].reverse();
    return topFirst.flatMap<ChartLayerEntry>((entry) => {
      if (entry.kind === 'bars') {
        return [BARS_LAYER_ENTRY];
      }
      const { toolId, drawingId } = entry.ref;
      const record = records.find((candidate) => candidate.toolId === toolId && candidate.id === drawingId);
      return record === undefined ? [] : [{ kind: 'drawing', record }];
    });
  }

  /** The drawings may have changed: drop the cached list and let its readers read it again. */
  private invalidateLayerList(): void {
    this.cachedLayerList = null;
    this.layerListeners.emit();
  }
}
