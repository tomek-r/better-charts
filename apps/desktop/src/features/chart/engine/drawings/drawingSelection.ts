import type { ChartDrawingSelection } from './drawingRecord';

/**
 * The drawing the user has selected, if any. It notifies its listener only once the
 * selection really changed, so a press on the already selected drawing repaints nothing.
 */
export class DrawingSelectionState {
  private selection: ChartDrawingSelection | null = null;

  constructor(private readonly onChanged: (selection: ChartDrawingSelection | null) => void) {}

  current(): ChartDrawingSelection | null {
    return this.selection;
  }

  set(selection: ChartDrawingSelection | null): void {
    if (isSameSelection(this.selection, selection)) {
      return;
    }
    this.selection = selection;
    this.onChanged(selection);
  }

  /** Drops the selection when it is this drawing: a deleted or replaced drawing leaves nothing selected. */
  clearIfDrawing(toolId: string, drawingId: string): void {
    const selection = this.selection;
    if (selection?.toolId === toolId && selection.drawingId === drawingId) {
      this.set(null);
    }
  }
}

/** Same drawing of the same tool with the same lock and visibility: nothing a toolbar or a paint would show changed. */
function isSameSelection(current: ChartDrawingSelection | null, next: ChartDrawingSelection | null): boolean {
  if (current === null || next === null) {
    return current === next;
  }
  return (
    current.toolId === next.toolId &&
    current.drawingId === next.drawingId &&
    current.locked === next.locked &&
    current.visible === next.visible
  );
}
