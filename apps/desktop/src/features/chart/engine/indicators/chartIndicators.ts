import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { HoveredBar } from '../legend/hoveredBar';
import { IndicatorLegend, type IndicatorLegendCommands } from '../legend/indicatorLegend';
import type { SettingValues } from '../settings/settingInputs';
import type { ChartIndicatorDefinition } from './indicatorContract';
import { indicatorDisplayOf, withoutStatusLineInputs } from './indicatorDisplaySettings';
import { DEFAULT_STATUS_LINE_APPEARANCE, type ChartStatusLineAppearance } from '../legend/statusLineAppearance';
import { IndicatorLayer, type IndicatorLegendValue } from './indicatorLayer';
import { IndicatorRuntime } from './indicatorRuntime';
import { PaneDragWatcher } from './paneDragWatcher';

/** What the chart owning the indicators tells them about itself. */
export interface ChartIndicatorsOptions {
  /** Every indicator a user can attach to this chart. */
  readonly definitions: readonly ChartIndicatorDefinition[];
  /** The legend's words for an attached indicator before its values, e.g. "SMA 9 close". */
  readonly legendTitle: (definitionId: string, settings: SettingValues) => string;
  /** The bars the indicators are computed over. */
  readonly bars: () => readonly RenderBar[];
  /** The price decimals the legend writes its values with. */
  readonly digits: () => number;
  /** The chart's price series, handed to an indicator that pushes frames. */
  readonly priceSeries: ISeriesApi<'Candlestick'>;
}

/**
 * The indicators of one chart: the layer that draws them, the runtime that feeds
 * them and the legend that names them, built and torn down together.
 */
export class ChartIndicators {
  /** The bar the pointer is over, which this legend follows and the OHLC line shares. */
  readonly hoveredBar: HoveredBar;
  readonly layer: IndicatorLayer;
  /** The app's row commands; null while none is mounted, and the legend's buttons then do nothing. */
  private commands: IndicatorLegendCommands | null = null;
  readonly runtime: IndicatorRuntime;
  private readonly legend: IndicatorLegend;
  private readonly legendTitle: ChartIndicatorsOptions['legendTitle'];
  /** The Status line tab's switches: which legend parts draw, and whether an indicator's inputs are named. */
  private statusLine = DEFAULT_STATUS_LINE_APPEARANCE;
  private readonly paneDragWatcher: PaneDragWatcher;

  constructor(chart: IChartApi, host: HTMLElement, options: ChartIndicatorsOptions) {
    this.legendTitle = options.legendTitle;
    this.hoveredBar = new HoveredBar(chart, options.bars);
    this.layer = new IndicatorLayer(chart);
    this.runtime = new IndicatorRuntime(
      this.layer,
      options.definitions,
      options.bars,
      () => this.legend.refresh(),
      options.priceSeries,
    );
    this.legend = new IndicatorLegend(
      host,
      {
        rows: (hoveredIndex) =>
          this.runtime.attachedState().map((attached) => ({
            instanceId: attached.instanceId,
            title: this.titleOf(attached.definitionId, attached.settings),
            hidden: attached.hidden,
            digits: this.layer.precisionOf(attached.instanceId),
            values: this.legendValuesOf(attached.instanceId, attached.settings, hoveredIndex),
            paneHost: this.layer.paneLegendHost(attached.instanceId),
          })),
        hoveredIndex: () => this.hoveredBar.index(),
        digits: options.digits,
      },
      {
        openSettings: (instanceId) => this.commands?.openSettings(instanceId),
        setHidden: (instanceId, hidden) => this.commands?.setHidden(instanceId, hidden),
        remove: (instanceId) => this.commands?.remove(instanceId),
        setPaneHeights: (heights) => this.commands?.setPaneHeights(heights),
        setLegendCollapsed: (collapsed) => this.commands?.setLegendCollapsed(collapsed),
      },
    );
    this.hoveredBar.subscribe(() => this.legend.refresh());
    this.paneDragWatcher = new PaneDragWatcher(
      host,
      () => this.layer.paneHeights(),
      (heights) => this.commands?.setPaneHeights(heights),
    );
  }

  /** Takes the commands the legend's row buttons forward to, or null to drop them. */
  setCommands(commands: IndicatorLegendCommands | null): void {
    this.commands = commands;
  }

  /** Applies the Status line tab's switches to the legend rows and redraws them. */
  setStatusLine(appearance: ChartStatusLineAppearance): void {
    this.statusLine = appearance;
    this.legend.setCollapsed(appearance.indicatorLegendCollapsed);
    this.legend.refresh();
  }

  destroy(): void {
    this.paneDragWatcher.destroy();
    this.hoveredBar.destroy();
    this.legend.destroy();
    // The runtime before the layer it draws through, as the controller tore them down.
    this.runtime.destroy();
    this.layer.destroy();
  }

  /** The legend's words for an attached indicator: empty while the status line shows no titles. */
  private titleOf(definitionId: string, settings: SettingValues): string {
    if (!this.statusLine.indicatorTitles) {
      return '';
    }
    const namedSettings = this.statusLine.indicatorInputs ? settings : withoutStatusLineInputs(settings);
    return this.legendTitle(definitionId, namedSettings);
  }

  /** The values the legend writes after `instanceId`'s words: none while the status line shows no values. */
  private legendValuesOf(instanceId: string, settings: SettingValues, barIndex: number): IndicatorLegendValue[] {
    if (!this.statusLine.indicatorValues || !indicatorDisplayOf(settings).valuesInStatusLine) {
      return [];
    }
    return this.layer.valuesAt(instanceId, barIndex);
  }
}
