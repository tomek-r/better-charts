import { PointerReadoutPrimitive } from '../legend/pointerReadoutPrimitive';
import type { ChartToolSet } from '../tools/toolSet';
import { isOutsidePane, type ViewportController } from '../viewport/viewportController';
import { ChartCursor } from './chartCursor';

/**
 * The pane's pointer: the axis labels every pointer shows, the tool the pointer reaches and the cursor the
 * chart sets. A position outside the pane hides both rather than clamping them, because a clamped readout
 * would print a time or price the pointer is not over.
 */
export class ChartPointer {
  /** The label primitive the price series draws; the time zone display hands it the format it paints with. */
  readonly labels: PointerReadoutPrimitive;
  private readonly cursor: ChartCursor;

  constructor(
    pane: HTMLElement,
    private readonly view: () => ViewportController,
    private readonly tools: () => ChartToolSet,
  ) {
    this.labels = new PointerReadoutPrimitive(
      () => this.view().viewport(),
      (target) => this.tools().draw(target),
    );
    // The tool set is built after the pointer, so the cursor asks it for the active tool only when it paints.
    this.cursor = new ChartCursor(pane, () => this.tools().isPlacementToolActive());
  }

  /** Follows the pointer over the pane; outside it the labels and the tool's hover both hide. */
  move(x: number, y: number): void {
    const { width, height } = this.view().paneSize();
    if (isOutsidePane(x, y, width, height)) {
      this.hide();
      return;
    }
    this.labels.move(x, y);
    this.tools().pointerHover(x, y);
  }

  hide(): void {
    this.labels.hide();
    this.tools().pointerLeave();
  }

  /** Whether the pointer rests on a plotted line the user can click, which the pane's cursor follows. */
  setOverPlot(overPlot: boolean): void {
    this.cursor.setOverPlot(overPlot);
  }

  /** The active tool's cursor, over which a plotted line's own cursor wins while the pointer rests on it. */
  setToolCursor(toolCursor: string | undefined): void {
    this.cursor.setToolCursor(toolCursor);
  }
}
