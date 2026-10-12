import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

/**
 * Holds the handles the library hands a series primitive on attach and drops
 * them on detach, so a primitive can never repaint or read a chart it is no
 * longer attached to. Subclasses extend `attached`/`detached` and call `super`.
 */
export abstract class AttachedSeriesPrimitive implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null;
  protected series: ISeriesApi<SeriesType, Time> | null = null;
  protected requestUpdate: (() => void) | null = null;

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  /** The chart's label font size, which the library sizes its own labels from. */
  protected labelFontSize(): number {
    return this.chart?.options().layout.fontSize ?? 11;
  }

  protected labelFontFamily(): string {
    return this.chart?.options().layout.fontFamily ?? 'sans-serif';
  }
}
