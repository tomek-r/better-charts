import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';

/** Remembers which logical bar the crosshair last pointed at, null while it is off the chart. */
export class LegendCrosshair {
  private logicalIndex: number | null = null;
  private readonly chart: IChartApi;
  private readonly moved: () => void;
  private readonly onCrosshairMove = (param: MouseEventParams<Time>): void => {
    this.logicalIndex = param.logical ?? null;
    this.moved();
  };

  constructor(chart: IChartApi, moved: () => void) {
    this.chart = chart;
    this.moved = moved;
    this.chart.subscribeCrosshairMove(this.onCrosshairMove);
  }

  /**
   * The logical index of the last crosshair move, null until one arrives and while the pointer is off
   * the chart.
   */
  logical(): number | null {
    return this.logicalIndex;
  }

  destroy(): void {
    this.chart.unsubscribeCrosshairMove(this.onCrosshairMove);
  }
}
