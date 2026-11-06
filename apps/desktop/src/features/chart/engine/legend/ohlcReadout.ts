import type { BarSeriesController, LegendBar } from '../bars/barSeriesController';
import type { RenderBar } from '../bars/renderBar';
import type { HoveredBar } from './hoveredBar';
import { barChangeReference, formatPriceChange, formatVolume, previousDayClose } from './legendValues';
import { OhlcLegend } from './ohlcLegend';
import {
  DEFAULT_STATUS_LINE_APPEARANCE,
  statusLineTitle,
  type ChartStatusLineAppearance,
} from './statusLineAppearance';

const STATUS_LINE_BACKGROUND_VARIABLE = '--chart-status-line-background';
const MARKET_STATUS_ON = 'on';
const MARKET_STATUS_OFF = 'off';

/** The last day change as the line writes it: its text, and the bar style's colour for its direction. */
interface DayChange {
  readonly text: string;
  readonly color: string | null;
}

type StatusLineBars = Pick<
  BarSeriesController,
  'legendBar' | 'pricePrecision' | 'bars' | 'intervalSeconds' | 'directionColor'
>;

/**
 * The last day change compares the newest loaded bar with the newest bar of an earlier broker day, so it
 * never follows the hovered bar; it is computed when the bars change and kept for the moves between them.
 */
function lastDayChangeOf(bars: StatusLineBars, digits: number): DayChange | null {
  const series = bars.bars;
  const lastBar: RenderBar | undefined = series[series.length - 1];
  const previousClose = previousDayClose(series, bars.intervalSeconds);
  if (lastBar === undefined || previousClose === null) {
    return null;
  }
  return {
    text: formatPriceChange(lastBar.close, previousClose, digits),
    color: bars.directionColor(lastBar.close >= previousClose),
  };
}

/**
 * Keeps the OHLC line on the bar under the pointer: the hovered bar reports the bar its time belongs to,
 * and the legend prints that bar's values.
 */
export class OhlcReadout {
  private readonly legend: OhlcLegend;
  private readonly hoveredBar: HoveredBar;
  private readonly stopFollowingHover: () => void;
  private appearance = DEFAULT_STATUS_LINE_APPEARANCE;
  private description: string | undefined;
  private lastDayChange: DayChange | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly bars: StatusLineBars,
    hoveredBar: HoveredBar,
    private readonly symbol: () => string,
  ) {
    this.legend = new OhlcLegend(host);
    this.hoveredBar = hoveredBar;
    this.stopFollowingHover = hoveredBar.subscribe(() => this.writeLine());
  }

  container(): HTMLElement {
    return this.legend.container();
  }

  setAppearance(appearance: ChartStatusLineAppearance): void {
    this.appearance = appearance;
    this.legend.container().dataset.marketStatus = appearance.marketStatus ? MARKET_STATUS_ON : MARKET_STATUS_OFF;
    this.applyBackground(appearance.background);
    this.refresh();
  }

  setSymbolDescription(description: string | undefined): void {
    this.description = description;
    this.refresh();
  }

  /** Recomputes what the bars decide, then writes the line for the bar the pointer is over. */
  refresh(): void {
    this.lastDayChange = lastDayChangeOf(this.bars, this.bars.pricePrecision);
    this.writeLine();
  }

  private writeLine(): void {
    const { appearance } = this;
    const digits = this.bars.pricePrecision;
    const shown = this.bars.legendBar(this.hoveredBar.index());
    this.legend.apply({
      title: appearance.title ? statusLineTitle(appearance.titleFormat, this.symbol(), this.description) : null,
      bar: shown?.bar,
      digits,
      chartValues: appearance.chartValues,
      valueColor: shown?.bodyColor ?? null,
      barChange: this.barChangeOf(shown, digits),
      volume: appearance.volume && shown ? formatVolume(shown.bar.volume) : null,
      lastDayChange: appearance.lastDayChange ? this.lastDayChange : null,
    });
  }

  private barChangeOf(shown: LegendBar | undefined, digits: number): string | null {
    if (!this.appearance.barChange || shown === undefined) {
      return null;
    }
    const reference = barChangeReference(shown.bar, shown.previous);
    return formatPriceChange(shown.bar.close, reference, digits);
  }

  private applyBackground(background: ChartStatusLineAppearance['background']): void {
    if (background.visible) {
      this.host.style.setProperty(STATUS_LINE_BACKGROUND_VARIABLE, background.color);
      return;
    }
    this.host.style.removeProperty(STATUS_LINE_BACKGROUND_VARIABLE);
  }

  destroy(): void {
    this.stopFollowingHover();
    this.legend.destroy();
  }
}
