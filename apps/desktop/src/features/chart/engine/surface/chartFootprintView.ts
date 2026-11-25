import type { BarSeriesController } from '../bars/barSeriesController';
import type { BarFootprint } from '../barStyle/volumeFootprint/footprintData';
import { FootprintNotice, type FootprintNotices } from '../legend/footprintNotice';

/**
 * Everything the footprint bar style asks of the chart surface: the footprints the host published for the
 * bars it read whole, which the bar series paints its columns from, and the legend notice of the ticks the
 * footprints only partly cover. The controller owns one, so the style's two setters leave it.
 */
export class ChartFootprintView {
  // What the footprint ticks do not cover; hidden while the host read every bar whole.
  private readonly notice: FootprintNotice;

  /**
   * Puts the notice beside `container`, the legend's OHLC readout, and writes its dates with `timeLabel`,
   * the chart's own time format, so it reads like the axis and the pointer. `barSeries` receives the
   * footprints, and `isRemoved` keeps every write off a controller that is already torn down.
   */
  constructor(
    container: HTMLElement,
    private readonly timeLabel: (atMs: number) => string,
    private readonly barSeries: BarSeriesController,
    private readonly isRemoved: () => boolean,
  ) {
    this.notice = new FootprintNotice(container);
  }

  /**
   * Draws the footprints the host published for the bars it read whole: the footprint style paints each
   * bar's columns from them, and every other style is left alone.
   */
  setFootprints(footprints: readonly BarFootprint[]): void {
    if (this.isRemoved()) {
      return;
    }
    this.barSeries.setFootprints(footprints);
  }

  /** The legend notice of the newest bar the host read only part way in, hidden once it reads one whole. */
  setNotices(notices: FootprintNotices): void {
    if (this.isRemoved()) {
      return;
    }
    this.notice.set(notices, this.timeLabel);
  }

  destroy(): void {
    this.notice.destroy();
  }
}
