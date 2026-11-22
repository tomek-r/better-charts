import type { ChartDrawingSelection } from '../drawings/drawingRecord';

/** The listener of a selection change: the id of the indicator now selected, or null. */
type IndicatorSelectionListener = (instanceId: string | null) => void;

/**
 * The indicator the user has selected, if any: the one owner of that state, as `ChartDrawings` owns the
 * drawing selection. It notifies its listeners only once the selection really changed, so a click on the
 * already selected row repaints nothing.
 */
export class IndicatorSelection {
  private selectedInstanceId: string | null = null;
  private readonly listeners = new Set<IndicatorSelectionListener>();

  /** `clearDrawingSelection` drops the drawing selection: TradingView keeps one selection at a time. */
  constructor(private readonly clearDrawingSelection: () => void) {}

  /** The indicator the user has selected, or null. */
  selected(): string | null {
    return this.selectedInstanceId;
  }

  /** Calls `listener` on every selection change; the returned function stops the calls. */
  subscribe(listener: IndicatorSelectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Selects one indicator, which drops the drawing selection; the selected one again changes nothing. */
  select(instanceId: string): void {
    if (this.selectedInstanceId === instanceId) {
      return;
    }
    this.clearDrawingSelection();
    this.set(instanceId);
  }

  /** Drops the selection; what Escape, a click on the pane and a removal ask. */
  clear(): void {
    this.set(null);
  }

  /** A drawing became the chart's selection: the indicator selection yields, so only one object is selected. */
  drawingSelected(selection: ChartDrawingSelection | null): void {
    if (selection !== null) {
      this.clear();
    }
  }

  /** Drops a selection the chart no longer draws, which is what removing the indicator does. */
  dropUnattached(attachedInstanceIds: readonly string[]): void {
    const selected = this.selectedInstanceId;
    if (selected !== null && !attachedInstanceIds.includes(selected)) {
      this.clear();
    }
  }

  private set(instanceId: string | null): void {
    if (this.selectedInstanceId === instanceId) {
      return;
    }
    this.selectedInstanceId = instanceId;
    // A listener may unsubscribe while it runs, so the loop runs over the listeners as they were.
    for (const listener of [...this.listeners]) {
      listener(instanceId);
    }
  }
}
