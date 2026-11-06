import type { IChartApi } from 'lightweight-charts';

/** Every pane's own prices are drawn against its right scale. */
const PRICE_SCALE_ID = 'right';

/** One pane as the chart lists it. Read it by index each time: the list shifts when a pane goes. */
type ChartPane = ReturnType<IChartApi['panes']>[number];

/** The pane the pointer is over and how wide that pane's price axis is. */
export interface AxisHit {
  readonly paneIndex: number;
  readonly width: number;
}

/**
 * The pane under the pointer whose axis column the pointer is over, or null. The axis is the last
 * `width()` pixels of the pane, which is the region the library itself treats as the price scale.
 * Invisible scales report width 0, so an empty pane keeps the rows out of the way.
 */
export function axisHitAt(chart: IChartApi, host: HTMLElement, event: PointerEvent): AxisHit | null {
  const hostBounds = host.getBoundingClientRect();
  const panes = chart.panes();
  for (let paneIndex = 0; paneIndex < panes.length; paneIndex += 1) {
    const hit = axisHitInPane(panes[paneIndex], paneIndex, event, hostBounds);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

function axisHitInPane(
  pane: ChartPane | undefined,
  paneIndex: number,
  event: PointerEvent,
  hostBounds: DOMRect,
): AxisHit | null {
  const element = pane?.getHTMLElement() ?? null;
  if (pane === undefined || element === null) {
    return null;
  }
  const paneBounds = element.getBoundingClientRect();
  if (event.clientY < paneBounds.top || event.clientY > paneBounds.bottom) {
    return null;
  }
  const width = pane.priceScale(PRICE_SCALE_ID).width();
  const overAxis = width > 0 && event.clientX >= hostBounds.right - width && event.clientX <= hostBounds.right;
  return overAxis ? { paneIndex, width } : null;
}
