import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { IndicatorLegend } from '../legend/indicatorLegend';
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
    this.legend = new IndicatorLegend(host, {
      rows: (logicalIndex) =>
        this.runtime.attachedState().map((attached) => ({
          instanceId: attached.instanceId,
          title: options.legendTitle(attached.definitionId, attached.settings),
          values: this.layer.valuesAt(attached.instanceId, logicalIndex),
        })),
      lastBarIndex: () => options.bars().length - 1,
      digits: options.digits,
    });
    this.chart.subscribeCrosshairMove(this.crosshairMoved);
  }

  destroy(): void {
    this.chart.unsubscribeCrosshairMove(this.crosshairMoved);
    this.legend.destroy();
    // The runtime before the layer it draws through, as the controller tore them down.
    this.runtime.destroy();
    this.layer.destroy();
  }
}
