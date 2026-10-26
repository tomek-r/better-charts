import type { ChartDrawingRecord, ChartDrawingSelection } from './drawingRecord';
import type { ToolInputValues } from './toolInputs';
import type { ChartToolSet } from '../tools/toolSet';

/** The drawing commands the class needs: the tool set's drawing API, not the whole set. */
export type ChartDrawingCommands = Pick<
  ChartToolSet,
  | 'selectedDrawing'
  | 'deleteSelectedDrawing'
  | 'setSelectedDrawingLocked'
  | 'setDrawingVisible'
  | 'setDrawingInputs'
  | 'exportDrawings'
  | 'replaceDrawings'
>;

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
 * The chart's drawings as the app sees them: the selection, the user's commands on it, and the
 * saved records. Every command that changes what is painted repaints.
 */
export class ChartDrawings {
  private readonly selectionListeners = new Listeners<[ChartDrawingSelection | null]>();
  private readonly changeListeners = new Listeners<[]>();

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
   * A committed drawing was created, edited or deleted: the app saves the drawing set again.
   * Answers the function that stops listening again.
   */
  subscribeChanges(listener: () => void): () => void {
    return this.changeListeners.add(listener);
  }

  /** The tool set reports the selection it painted: repaint it, then let the app hear about it. */
  selectionChanged(selection: ChartDrawingSelection | null): void {
    this.repaint();
    this.selectionListeners.emit(selection);
  }

  drawingsChanged(): void {
    this.changeListeners.emit();
  }

  /** The drawing the user has selected, or null. */
  selected(): ChartDrawingSelection | null {
    return this.commands.selectedDrawing();
  }

  /** Removes the selected drawing only, even when it is locked; false when nothing is selected. */
  deleteSelected(): boolean {
    if (!this.commands.deleteSelectedDrawing()) {
      return false;
    }
    this.repaint();
    return true;
  }

  setSelectedLocked(locked: boolean): void {
    this.commands.setSelectedDrawingLocked(locked);
    this.repaint();
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

  exportRecords(): ChartDrawingRecord[] {
    return this.commands.exportDrawings();
  }

  replaceRecords(records: readonly ChartDrawingRecord[]): void {
    this.commands.replaceDrawings(records);
    this.repaint();
  }
}
