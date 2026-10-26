import type {
  IChartApi,
  IPaneApi,
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
export abstract class ChartSeriesPrimitive implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null;
  protected series: ISeriesApi<SeriesType, Time> | null = null;
  protected requestUpdate: (() => void) | null = null;

  /**
   * Pane the series lives in, resolved once on attach so nothing walks the pane
   * list on the per-frame path; `refreshPaneHeight` re-reads its height.
   */
  private hostPane: IPaneApi<Time> | null = null;
  /** Height a price-axis tag must stay inside, as of the last `refreshPaneHeight`. */
  protected paneHeight = 0;

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    this.hostPane = chart.panes().find((candidate) => candidate.getSeries().includes(series)) ?? null;
    this.refreshPaneHeight();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.hostPane = null;
    this.paneHeight = 0;
  }

  protected refreshPaneHeight(): void {
    this.paneHeight = this.hostPane?.getHeight() ?? 0;
  }

  /** The chart's label font size, which the library sizes its own labels from. */
  protected labelFontSize(): number {
    return this.chart?.options().layout.fontSize ?? 11;
  }

  protected labelFontFamily(): string {
    return this.chart?.options().layout.fontFamily ?? 'sans-serif';
  }
}
