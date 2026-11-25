import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { BridgeState, QuoteSnapshot } from '../../../../shared/bridge/types';
import type { BarSeriesController } from '../bars/barSeriesController';
import type { ChartTypeBarSource } from '../bars/chartTypeBars';
import type { BarStyleAppearance } from '../barStyle/barStyleAppearance';
import { FootprintZoom, type FootprintZoomPane } from '../barStyle/volumeFootprint/footprintZoom';
import { BarCountdownPrimitive } from '../barCountdown/barCountdownPrimitive';
import { CountdownController } from '../barCountdown/countdownController';
import { BrokerTime } from '../brokerTime/brokerTime';
import { ChartTimeZoneDisplay } from '../brokerTime/chartTimeZoneDisplay';
import type { ChartIndicators } from '../indicators/chartIndicators';
import { chartStatusLine, type ChartStatusLine } from '../legend/chartStatusLine';
import type { MarketStatus } from '../legend/marketStatus';
import { MarketStatusIndicator } from '../legend/marketStatusIndicator';
import { OhlcReadout } from '../legend/ohlcReadout';
import type { ChartOverlayState } from './buildChartPlugins';
import { ChartFootprintView } from './chartFootprintView';

/** The pointer readout the chart's one time format is published to, as the time zone display takes it. */
type TimeFormatSink = ConstructorParameters<typeof ChartTimeZoneDisplay>[1];

/** What the chart's readouts read of it, none of which exists until the controller has built it. */
export interface ChartReadoutSeams {
  /** The chart's host: the legend's lines, the market dot and the footprint notice are built into it. */
  readonly host: HTMLElement;
  /** The chart's handle, which the one time format is applied to. */
  readonly chart: IChartApi;
  /** The price series the countdown tag is attached to and detached from. */
  readonly candles: ISeriesApi<'Candlestick'>;
  /** The pointer's time label, which the one chart time format reaches together with the axis. */
  readonly labels: TimeFormatSink;
  /** The bar cache: what the lines print, the columns paint from and the countdown mirrors. */
  readonly data: BarSeriesController;
  /** The bar under the pointer and the indicator rows the chart's one status line draws. */
  readonly indicators: Pick<ChartIndicators, 'hoveredBar' | 'setStatusLine'>;
  /** The shown symbol, which the OHLC line names and the countdown tags. */
  readonly symbol: () => string;
  /** The live quote state, whose Bid/Ask the countdown reads. */
  readonly overlayState: ChartOverlayState;
  /** The bars a chart type draws, which close on a price move rather than at a time. */
  readonly chartTypeBars: () => ChartTypeBarSource;
  /** The pane the footprint style's zoom is written to. */
  readonly pane: FootprintZoomPane;
  /** Whether the controller is already torn down, which keeps every footprint write off it. */
  readonly isRemoved: () => boolean;
}

/**
 * The chart's readouts and the broker clock they are read against: the OHLC line the bar under the pointer
 * fills and the market status dot beside it, the footprint style's columns with the legend notice of the
 * ticks they only partly cover and the room those columns need, and the countdown tag. One unit, because
 * each of them reports the broker's current state and writes its times with the one format the chart applies.
 */
export class ChartReadouts {
  /** The footprint style's columns and the legend notice of what its ticks miss. */
  readonly footprints: ChartFootprintView;
  /** The countdown's state, which the scales presenter drives the axis tag with. */
  readonly countdown: CountdownController;
  /** The chart's time format, which the axis, the pointer and the footprint notice write their dates with. */
  readonly timeLabels: ChartTimeZoneDisplay;
  // Broker time from the live ticks; the countdown and the time zone clock both read it.
  private readonly brokerTime = new BrokerTime();
  private readonly countdownPrimitive = new BarCountdownPrimitive(this.brokerTime);
  private readonly readout: OhlcReadout;
  private readonly marketStatus: MarketStatusIndicator;
  // The room the footprint style's columns need, which choosing that style zooms the pane in for.
  private readonly zoom: FootprintZoom;

  constructor(private readonly seams: ChartReadoutSeams) {
    const { hoveredBar } = seams.indicators;
    this.timeLabels = new ChartTimeZoneDisplay(seams.chart, seams.labels, this.brokerTime);
    this.readout = new OhlcReadout(seams.host, seams.data, hoveredBar, seams.symbol);
    this.marketStatus = new MarketStatusIndicator(this.readout.container());
    this.footprints = new ChartFootprintView(
      this.readout.container(),
      (atMs) => this.timeLabels.timeLabel(atMs),
      seams.data,
      seams.isRemoved,
    );
    this.zoom = new FootprintZoom(seams.pane);
    // The countdown tag is its own primitive: it paints on the axis canvas and owns the timer that repaints
    // it. It is attached here so it stays the chart's second primitive, under the Bid/Ask tags.
    seams.candles.attachPrimitive(this.countdownPrimitive);
    this.countdown = new CountdownController(this.countdownPrimitive, {
      symbol: seams.symbol,
      timeframe: () => seams.data.timeframe,
      barTimeSeconds: () => seams.data.lastBar()?.time,
      bid: () => seams.overlayState.priceLines.bid,
      ask: () => seams.overlayState.priceLines.ask,
      chartTypeBars: () => seams.chartTypeBars().drawsOwnBars,
    });
  }

  /** Recomputes what the bars decide and writes the OHLC line for the bar under the pointer. */
  refresh(): void {
    this.readout.refresh();
  }

  /** Reads the bars at the precision the clock now shows, then writes the OHLC line again. */
  barsChanged(): void {
    const { data, chartTypeBars } = this.seams;
    this.timeLabels.applyInterval(data.timeframe, chartTypeBars().drawsOwnBars);
    this.readout.refresh();
  }

  /** The OHLC line and the indicator rows that the settings dialog's Status line tab controls. */
  statusLine(): ChartStatusLine {
    return chartStatusLine(this.readout, this.seams.indicators);
  }

  /** Whether the shown symbol's market is open, as the legend's dot reports it. */
  setMarketStatus(status: MarketStatus, label: string): void {
    this.marketStatus.set(status, label);
  }

  /** Shows every bar in `zone`'s wall clock; broker time until the broker offset is known. */
  setTimeZone(zone: string, brokerUtcOffsetMinutes: number | null): void {
    this.timeLabels.apply(zone, brokerUtcOffsetMinutes);
  }

  /** Reads a live quote's broker time, which the countdown's tag counts from. */
  setQuoteClock(quote?: QuoteSnapshot): void {
    if (quote) {
      this.brokerTime.acceptQuote(quote);
    }
  }

  /** Suspends the countdown while the ticks of the bar it counts are still being applied. */
  setCountdownPending(pending: boolean): void {
    this.countdown.setPending(pending);
  }

  /** The bridge's connection, which the tag draws as connected or not; its caller syncs the tag afterwards. */
  setConnection(state: BridgeState, identity: string): void {
    this.brokerTime.setConnection(state, identity);
    this.countdown.setConnection(state);
  }

  /** UTC now as the broker's ticks tell it; the desktop clock until a live tick and the broker's offset are known. */
  clockNowMs(): number {
    return this.timeLabels.clockNowMs();
  }

  /** Zooms the pane in for the room the footprint style's columns need, and back out when it is left. */
  followBarStyle(style: BarStyleAppearance['style']): void {
    this.zoom.followStyle(style);
  }

  /** Puts the footprint style's room back after a reset took the pane to the default zoom. */
  ensureFootprintRoom(): void {
    this.zoom.ensureRoom();
  }

  destroy(): void {
    this.seams.candles.detachPrimitive(this.countdownPrimitive);
    this.marketStatus.destroy();
    this.footprints.destroy();
    this.readout.destroy();
  }
}
