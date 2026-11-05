import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { IndicatorLegend, type IndicatorLegendCommands } from '../legend/indicatorLegend';
import type { SettingValues } from '../settings/settingInputs';
import type { ChartIndicatorDefinition } from './indicatorContract';
import { IndicatorLayer } from './indicatorLayer';
import { IndicatorRuntime } from './indicatorRuntime';

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
}

/**
 * The indicators of one chart: the layer that draws them, the runtime that feeds
 * them and the legend that names them, built and torn down together.
 */
export class ChartIndicators {
  readonly layer: IndicatorLayer;
  /** The app's row commands; null while none is mounted, and the legend's buttons then do nothing. */
  private commands: IndicatorLegendCommands | null = null;
  readonly runtime: IndicatorRuntime;
  private readonly legend: IndicatorLegend;
  private readonly crosshairMoved = (param: MouseEventParams<Time>): void => {
    this.legend.crosshairMoved(param.logical ?? null);
  };

  constructor(
    private readonly chart: IChartApi,
    host: HTMLElement,
    options: ChartIndicatorsOptions,
  ) {
    this.layer = new IndicatorLayer(chart);
    this.runtime = new IndicatorRuntime(this.layer, options.definitions, options.bars, () => this.legend.refresh());
    this.legend = new IndicatorLegend(
      host,
      {
        rows: (logicalIndex) =>
          this.runtime.attachedState().map((attached) => ({
            instanceId: attached.instanceId,
            title: options.legendTitle(attached.definitionId, attached.settings),
            hidden: attached.hidden,
            digits: this.layer.precisionOf(attached.instanceId),
            values: this.layer.valuesAt(attached.instanceId, logicalIndex),
            paneHost: this.layer.paneLegendHost(attached.instanceId),
          })),
        lastBarIndex: () => options.bars().length - 1,
        digits: options.digits,
      },
      {
        openSettings: (instanceId) => this.commands?.openSettings(instanceId),
        setHidden: (instanceId, hidden) => this.commands?.setHidden(instanceId, hidden),
        remove: (instanceId) => this.commands?.remove(instanceId),
      },
    );
    this.chart.subscribeCrosshairMove(this.crosshairMoved);
  }

  /** Takes the commands the legend's row buttons forward to, or null to drop them. */
  setCommands(commands: IndicatorLegendCommands | null): void {
    this.commands = commands;
  }

  destroy(): void {
    this.chart.unsubscribeCrosshairMove(this.crosshairMoved);
    this.legend.destroy();
    // The runtime before the layer it draws through, as the controller tore them down.
    this.runtime.destroy();
    this.layer.destroy();
  }
}
