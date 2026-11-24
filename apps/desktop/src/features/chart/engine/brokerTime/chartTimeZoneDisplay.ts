import type { IChartApi, TickMarkFormatter } from 'lightweight-charts';
import { isTickInterval } from '../../../../shared/bridge/chartIntervals';
import {
  createChartTimeFormat,
  DEFAULT_CHART_TIME_LABELS,
  sameChartTimeLabels,
  type ChartTimeFormat,
  type ChartTimeLabels,
  type ChartTimePrecision,
} from '../../timeZone/chartTimeFormat';
import { EXCHANGE_TIME_ZONE } from '../../timeZone/chartTimeZones';
import type { BrokerTime } from './brokerTime';

/** The pointer readout's seam: the display only ever hands it a new format. */
interface TimeFormatTarget {
  setTimeFormat(format: ChartTimeFormat): void;
}

/**
 * The chart's time-zone display: the format the axis' tick labels and the pointer's
 * time label are drawn with, and the broker clock that format is read against. It
 * owns the applied zone and label choices, so a caller only says when one changes.
 */
export class ChartTimeZoneDisplay {
  /** The zone the axis and the pointer labels are currently formatted in; broker time until told otherwise. */
  private appliedTimeZone = EXCHANGE_TIME_ZONE;
  private appliedBrokerOffsetMinutes: number | null = null;
  private appliedLabels: ChartTimeLabels = DEFAULT_CHART_TIME_LABELS;
  /** The bars' precision: an MT5 bar reads its minute until a tick interval asks for its second. */
  private appliedPrecision: ChartTimePrecision = 'minute';

  constructor(
    private readonly chart: IChartApi,
    private readonly pointerReadout: TimeFormatTarget,
    private readonly brokerTime: BrokerTime,
  ) {}

  /**
   * Shows every bar in `zone`'s wall clock. One format object feeds the time axis' tick labels and
   * the pointer's time label, so the two can never disagree about which zone is on screen.
   * `brokerUtcOffsetMinutes` is what turns a bar's broker wall time into a real instant; while it
   * is unknown the chart can only show broker time.
   */
  apply(zone: string, brokerUtcOffsetMinutes: number | null): void {
    if (zone === this.appliedTimeZone && brokerUtcOffsetMinutes === this.appliedBrokerOffsetMinutes) {
      return;
    }
    this.appliedTimeZone = zone;
    this.appliedBrokerOffsetMinutes = brokerUtcOffsetMinutes;
    this.publish();
  }

  /** Writes the labels in `labels`' date and hour formats, from the weekday on or off. */
  setLabels(labels: ChartTimeLabels): void {
    if (sameChartTimeLabels(labels, this.appliedLabels)) {
      return;
    }
    this.appliedLabels = labels;
    this.publish();
  }

  /**
   * Reads the bars' time to what `interval` shows on screen: a tick bar closes after a number of ticks and a
   * chart type's bar when its move happens, so each one's own second is what tells one from the next, while
   * every MT5 bar keeps its minute.
   */
  applyInterval(interval: string, secondPrecision = false): void {
    const precision: ChartTimePrecision = secondPrecision || isTickInterval(interval) ? 'second' : 'minute';
    if (precision === this.appliedPrecision) {
      return;
    }
    this.appliedPrecision = precision;
    this.publish();
  }

  /** The label choices the axis and the pointer are drawn with, as a plain copy. */
  labels(): ChartTimeLabels {
    return { ...this.appliedLabels };
  }

  /** UTC now as the broker's ticks tell it; the desktop clock until a live tick and the broker's offset are known. */
  clockNowMs(): number {
    const brokerOffsetMinutes = this.appliedBrokerOffsetMinutes;
    const brokerUtcNowMs = brokerOffsetMinutes === null ? null : this.brokerTime.utcNowMs(brokerOffsetMinutes);
    return brokerUtcNowMs ?? Date.now();
  }

  /** Hands the axis and the pointer the one format both of them draw their time text with. */
  private publish(): void {
    const format = createChartTimeFormat(
      this.appliedTimeZone,
      this.appliedBrokerOffsetMinutes,
      this.appliedLabels,
      this.appliedPrecision,
    );
    // A date or a business day has no instant to shift: those keep the library's own label.
    const tickMarkFormatter: TickMarkFormatter = (time, tickMarkType) =>
      typeof time === 'number' ? format.tickMarkLabel(time, tickMarkType) : null;
    // The library places a mark per second only when it is asked to show them, which a tick chart needs.
    const secondsVisible = this.appliedPrecision === 'second';
    this.chart.applyOptions({ timeScale: { tickMarkFormatter, secondsVisible } });
    this.pointerReadout.setTimeFormat(format);
  }
}
