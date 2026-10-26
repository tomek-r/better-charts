import type { ChartDrawingRecord, ChartDrawingSelection } from './drawingRecord';
import type { ToolInputValues } from './toolInputs';
import type { ChartToolSet } from '../tools/toolSet';

/** The drawing commands the class needs: the tool set's drawing API, not the whole set. */
export type ChartDrawingCommands = Pick<
  ChartToolSet,
  | 'selectedDrawing'
  | 'deleteSelectedDrawing'
  | 'setSelectedDrawingLocked'
  | 'setDrawingInputs'
  | 'exportDrawings'
  | 'replaceDrawings'
>;

/**
 * The chart's drawings as the app sees them: the selection, the user's commands on it, and the
 * saved records. Every command that changes what is painted repaints.
 */
export class ChartDrawings {
  /** The user picked another drawing or cleared the selection; null means nothing is selected. */
  onSelectionChange?: (selection: ChartDrawingSelection | null) => void;
  /** A committed drawing was created, edited or deleted: the app saves the drawing set again. */
  onChange?: () => void;

  constructor(
    private readonly commands: ChartDrawingCommands,
    private readonly repaint: () => void,
  ) {}

  /** The tool set reports the selection it painted: repaint it, then let the app hear about it. */
  selectionChanged(selection: ChartDrawingSelection | null): void {
    this.repaint();
    this.onSelectionChange?.(selection);
  }

  drawingsChanged(): void {
    this.onChange?.();
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
