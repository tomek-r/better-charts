import type { IChartApi, TickMarkFormatter } from 'lightweight-charts';
import { createChartTimeFormat, type ChartTimeFormat } from '../../timeZone/chartTimeFormat';
import { EXCHANGE_TIME_ZONE } from '../../timeZone/chartTimeZones';
import type { BrokerTime } from './brokerTime';

/** The pointer readout's seam: the display only ever hands it a new format. */
export interface TimeFormatTarget {
  setTimeFormat(format: ChartTimeFormat): void;
}

/**
 * The chart's time-zone display: the format the axis' tick labels and the pointer's
 * time label are drawn with, and the broker clock that format is read against. It
 * owns the applied zone, so a caller only says when to change it.
 */
export class ChartTimeZoneDisplay {
  /** The zone the axis and the pointer labels are currently formatted in; broker time until told otherwise. */
  private appliedTimeZone = EXCHANGE_TIME_ZONE;
  private appliedBrokerOffsetMinutes: number | null = null;

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
    const format = createChartTimeFormat(zone, brokerUtcOffsetMinutes);
    // A date or a business day has no instant to shift: those keep the library's own label.
    const tickMarkFormatter: TickMarkFormatter = (time, tickMarkType) =>
      typeof time === 'number' ? format.tickMarkLabel(time, tickMarkType) : null;
    this.chart.applyOptions({ timeScale: { tickMarkFormatter } });
    this.pointerReadout.setTimeFormat(format);
  }

  /** UTC now as the broker's ticks tell it; the desktop clock until a live tick and the broker's offset are known. */
  clockNowMs(): number {
    const brokerOffsetMinutes = this.appliedBrokerOffsetMinutes;
    const brokerUtcNowMs = brokerOffsetMinutes === null ? null : this.brokerTime.utcNowMs(brokerOffsetMinutes);
    return brokerUtcNowMs ?? Date.now();
  }
}
