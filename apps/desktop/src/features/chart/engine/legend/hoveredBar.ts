import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';

/** The index reported while the chart holds no bar. */
const NO_BAR = -1;

/**
 * The time the crosshair points at, in the UTC seconds the bars hold. A text time belongs to a
 * business-day scale, which this chart never uses, so it reads as no bar at all.
 */
function hoveredSecondsOf(time: Time | undefined): number | null {
  return typeof time === 'number' ? time : null;
}

/** The index of the bar at `time`, or -1 when no bar has that time; the bars are in ascending time order. */
function barIndexAt(bars: readonly RenderBar[], time: number): number {
  let first = 0;
  let last = bars.length - 1;
  while (first <= last) {
    const middle = Math.floor((first + last) / 2);
    const bar = bars[middle];
    if (bar === undefined) {
      return NO_BAR;
    }
    if (bar.time === time) {
      return middle;
    }
    if (bar.time < time) {
      first = middle + 1;
    } else {
      last = middle - 1;
    }
  }
  return NO_BAR;
}

/**
 * The bar the pointer is over, which the OHLC line and the indicator legend follow.
 *
 * It holds the time the pointer is at rather than an index: a page of older bars prepended, or a
 * replaced history, moves every index, while the bar at a time stays the bar at that time. Listeners
 * hear only a move to another time, so a pointer resting inside one bar redraws nothing.
 */
export class HoveredBar {
  private time: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly crosshairMoved = (param: MouseEventParams<Time>): void => {
    const time = hoveredSecondsOf(param.time);
    if (time === this.time) {
      return;
    }
    this.time = time;
    for (const listener of this.listeners) {
      listener();
    }
  };

  constructor(
    private readonly chart: IChartApi,
    private readonly bars: () => readonly RenderBar[],
  ) {
    this.chart.subscribeCrosshairMove(this.crosshairMoved);
  }

  /**
   * The index of the bar the pointer is over, the last bar's index while the pointer is off the chart
   * or over a time no bar has, and -1 while the chart holds no bars.
   */
  index(): number {
    const bars = this.bars();
    if (bars.length === 0) {
      return NO_BAR;
    }
    const time = this.time;
    const found = time === null ? NO_BAR : barIndexAt(bars, time);
    return found === NO_BAR ? bars.length - 1 : found;
  }

  /** Calls `listener` when the pointer reaches another time; the returned function stops the calls. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.chart.unsubscribeCrosshairMove(this.crosshairMoved);
  }
}
