import type { IChartApi } from 'lightweight-charts';
import type { BarSeriesController, LegendBar } from '../bars/barSeriesController';
import type { RenderBar } from '../bars/renderBar';
import type { ChartIndicators } from '../indicators/chartIndicators';
import { palette } from '../../../../shared/theme/palette';
import { barChangeReference, formatPriceChange, formatVolume, previousDayClose } from './legendValues';
import { LegendCrosshair } from './legendCrosshair';
import { OhlcLegend } from './ohlcLegend';
import {
  DEFAULT_STATUS_LINE_APPEARANCE,
  statusLineTitle,
  type ChartStatusLineAppearance,
} from './statusLineAppearance';

const STATUS_LINE_BACKGROUND_VARIABLE = '--chart-status-line-background';
const MARKET_STATUS_ON = 'on';
const MARKET_STATUS_OFF = 'off';

type StatusLineBars = Pick<BarSeriesController, 'legendBar' | 'pricePrecision' | 'bars' | 'intervalSeconds'>;

/**
 * The last day change compares the newest loaded bar with the newest bar of an
 * earlier broker day, so it never follows the hovered bar.
 */
function lastDayChangeOf(bars: StatusLineBars, digits: number): { text: string; color: string } | null {
  const series = bars.bars;
  const lastBar: RenderBar | undefined = series[series.length - 1];
  const previousClose = previousDayClose(series, bars.intervalSeconds);
  if (lastBar === undefined || previousClose === null) {
    return null;
  }
  return {
    text: formatPriceChange(lastBar.close, previousClose, digits),
    color: lastBar.close >= previousClose ? palette.up : palette.sell,
  };
}

/**
 * Keeps the OHLC line on the bar under the pointer: the crosshair reports the
 * logical index it sits on, and the legend prints that bar's values.
 */
export class OhlcReadout {
  private readonly legend: OhlcLegend;
  private readonly crosshair: LegendCrosshair;
  private appearance = DEFAULT_STATUS_LINE_APPEARANCE;
  private description: string | undefined;

  constructor(
    chart: IChartApi,
    private readonly host: HTMLElement,
    private readonly bars: StatusLineBars,
    private readonly indicators: Pick<ChartIndicators, 'setStatusLine'>,
    private readonly symbol: () => string,
  ) {
    this.legend = new OhlcLegend(host);
    this.crosshair = new LegendCrosshair(chart, () => this.refresh());
  }

  container(): HTMLElement {
    return this.legend.container();
  }

  setAppearance(appearance: ChartStatusLineAppearance): void {
    this.appearance = appearance;
    this.legend.container().dataset.marketStatus = appearance.marketStatus ? MARKET_STATUS_ON : MARKET_STATUS_OFF;
    this.applyBackground(appearance.background);
    this.indicators.setStatusLine(appearance);
    this.refresh();
  }

  setSymbolDescription(description: string | undefined): void {
    this.description = description;
    this.refresh();
  }

  refresh(): void {
    const shown = this.bars.legendBar(this.crosshair.logical());
    const { appearance } = this;
    const digits = this.bars.pricePrecision;
    this.legend.apply({
      title: appearance.title ? statusLineTitle(appearance.titleFormat, this.symbol(), this.description) : null,
      bar: shown?.bar,
      digits,
      chartValues: appearance.chartValues,
      valueColor: shown?.bodyColor ?? null,
      barChange: this.barChangeOf(shown, digits),
      volume: appearance.volume && shown ? formatVolume(shown.bar.volume) : null,
      lastDayChange: appearance.lastDayChange ? lastDayChangeOf(this.bars, digits) : null,
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
    this.legend.destroy();
    this.crosshair.destroy();
  }
}
