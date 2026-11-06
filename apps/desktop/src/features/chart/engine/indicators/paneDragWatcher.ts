import type { IndicatorPaneHeight } from './indicatorLayer';

/**
 * The heights `resized` gives differently from `snapshot`, which is what the user dragged. An entry the
 * snapshot does not hold appeared during the drag and is left alone: it was never on screen to resize.
 */
function draggedPaneHeights(
  snapshot: readonly IndicatorPaneHeight[],
  resized: readonly IndicatorPaneHeight[],
): IndicatorPaneHeight[] {
  const heightsBefore = new Map(snapshot.map((entry) => [entry.instanceId, entry.paneHeight]));
  return resized.filter((entry) => {
    const before = heightsBefore.get(entry.instanceId);
    return before !== undefined && before !== entry.paneHeight;
  });
}

/** Reports the panes the user resized by dragging a separator, which only the library knows about. */
export class PaneDragWatcher {
  /** The pane heights when the pointer went down; null while no drag is watched and none just ended. */
  private paneHeightsBeforeDrag: readonly IndicatorPaneHeight[] | null = null;
  /**
   * The pointer going down anywhere on the chart may start a drag of a pane separator, which only the
   * library knows about: the heights are snapshotted here and compared when the pointer comes up.
   */
  private readonly pointerDown = (): void => {
    this.paneHeightsBeforeDrag = this.paneHeights();
    window.addEventListener('pointerup', this.pointerReleased);
    window.addEventListener('pointercancel', this.pointerReleased);
  };
  private readonly pointerReleased = (): void => {
    const snapshot = this.paneHeightsBeforeDrag;
    this.stopWatchingDrag();
    if (snapshot === null) {
      return;
    }
    const dragged = draggedPaneHeights(snapshot, this.paneHeights());
    if (dragged.length > 0) {
      this.onDragged(dragged);
    }
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly paneHeights: () => readonly IndicatorPaneHeight[],
    private readonly onDragged: (heights: readonly IndicatorPaneHeight[]) => void,
  ) {
    // The capture phase sees the pointer before the library's separator handle takes it for its drag.
    this.host.addEventListener('pointerdown', this.pointerDown, true);
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.pointerDown, true);
    this.stopWatchingDrag();
  }

  /** Stops watching for the end of a drag the pointer may never finish. */
  private stopWatchingDrag(): void {
    this.paneHeightsBeforeDrag = null;
    window.removeEventListener('pointerup', this.pointerReleased);
    window.removeEventListener('pointercancel', this.pointerReleased);
  }
}
