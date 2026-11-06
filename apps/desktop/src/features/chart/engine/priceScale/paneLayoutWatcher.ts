import type { IChartApi } from 'lightweight-charts';

/**
 * Watches the chart host and every pane element for size changes: a row is placed from that geometry,
 * so a pane the chart has just laid out or resized would otherwise keep its row beside the wrong axis.
 * The panes' elements are new whenever the pane count changes, so they are re-observed then. However
 * many elements change, the layout callback runs once, in the next frame.
 */
export class PaneLayoutWatcher {
  private readonly resizeObserver: ResizeObserver;
  private paneCount = 0;
  private frame = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private readonly onLayout: () => void,
  ) {
    this.resizeObserver = new ResizeObserver(this.requestLayout);
    this.resizeObserver.observe(host);
  }

  /** Re-observes the host and the panes after the pane count changed; unchanged panes are left alone. */
  watchPanes(paneCount: number): void {
    if (paneCount === this.paneCount) {
      return;
    }
    const elements = this.paneElements();
    // A pane whose DOM the chart has not built yet is picked up by a later call, so the count is kept
    // unchanged until every pane has one.
    if (elements.length !== paneCount) {
      return;
    }
    this.paneCount = paneCount;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(this.host);
    for (const element of elements) {
      this.resizeObserver.observe(element);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver.disconnect();
  }

  private paneElements(): HTMLElement[] {
    const elements = this.chart.panes().map((pane) => pane.getHTMLElement());
    return elements.filter((element): element is HTMLElement => element !== null);
  }

  private readonly requestLayout = (): void => {
    if (this.frame !== 0) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.onLayout();
    });
  };
}
