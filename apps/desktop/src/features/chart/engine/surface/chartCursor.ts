/** The pane cursor over a plot line, which a click there selects the indicator of. */
const PLOT_HOVER_CURSOR = 'pointer';

/**
 * Owns the pane's cursor, for which two things compete: the pointer resting on a plot line the user
 * can click, and the active tool's own cursor. A placement tool keeps its cursor, because a click
 * there draws a drawing instead of selecting.
 */
export class ChartCursor {
  private toolCursor: string | undefined;
  private overPlot = false;

  constructor(
    private readonly pane: HTMLElement,
    private readonly isPlacementToolActive: () => boolean,
  ) {}

  /** The active tool's cursor: a placement tool's while it is active, the default tool's otherwise. */
  setToolCursor(toolCursor: string | undefined): void {
    this.toolCursor = toolCursor;
    this.refresh();
  }

  /** Whether the pointer rests on a plotted line the user can click. */
  setOverPlot(overPlot: boolean): void {
    this.overPlot = overPlot;
    this.refresh();
  }

  /** Writes the pane's cursor: the plot line's wins, so the pane offers the click the pointer accepts. */
  private refresh(): void {
    if (this.overPlot && !this.isPlacementToolActive()) {
      this.pane.style.cursor = PLOT_HOVER_CURSOR;
      return;
    }
    this.pane.style.cursor = this.toolCursor ?? '';
  }
}
