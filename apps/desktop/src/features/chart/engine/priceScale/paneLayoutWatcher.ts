import type { IChartApi } from 'lightweight-charts';

/**
 * Watches the chart host and every pane element for size changes: a row is placed from that geometry,
 * so a pane the chart has just laid out or resized would otherwise keep its row beside the wrong axis.
 * A pane the chart replaces hands out a new element, so the panes are compared by identity and re-observed
 * whenever one of them changed, however many panes the chart has. Whatever changed, the layout callback
 * runs once, in the next frame.
 */
export class PaneLayoutWatcher {
  private readonly resizeObserver: ResizeObserver;
  private observedPanes: readonly HTMLElement[] = [];
  private frame = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private readonly onLayout: () => void,
  ) {
    this.resizeObserver = new ResizeObserver(this.requestLayout);
    this.resizeObserver.observe(host);
  }

  /** Re-observes the host and the panes when the chart replaced one of them; an unchanged set is left alone. */
  watchPanes(): void {
    const elements = this.paneElements();
    // A pane whose DOM the chart has not built yet is picked up by a later call, so nothing is re-observed
    // until every pane has an element.
    if (elements === undefined) {
      return;
    }
    if (sameElements(elements, this.observedPanes)) {
      return;
    }
    this.observedPanes = elements;
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

  /** Every pane's element, or undefined while the chart has not built one of them yet. */
  private paneElements(): HTMLElement[] | undefined {
    const elements: HTMLElement[] = [];
    for (const pane of this.chart.panes()) {
      const element = pane.getHTMLElement();
      if (element === null) {
        return undefined;
      }
      elements.push(element);
    }
    return elements;
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

function sameElements(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}
