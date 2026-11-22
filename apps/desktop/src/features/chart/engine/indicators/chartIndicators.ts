import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { HoveredBar } from '../legend/hoveredBar';
import { IndicatorLegend, type IndicatorLegendCommands, type IndicatorLegendWords } from '../legend/indicatorLegend';
import type { SettingValues } from '../settings/settingInputs';
import type { ChartIndicatorDefinition } from './indicatorContract';
import { indicatorDisplayOf, withoutStatusLineInputs } from './indicatorDisplaySettings';
import { DEFAULT_STATUS_LINE_APPEARANCE, type ChartStatusLineAppearance } from '../legend/statusLineAppearance';
import { IndicatorLayer, type IndicatorLegendValue } from './indicatorLayer';
import { panePointOf } from './indicatorPanePoint';
import { IndicatorRuntime } from './indicatorRuntime';
import type { IndicatorSelection } from './indicatorSelection';
import type { IndicatorSeriesSource } from './indicatorSeriesSource';
import type { IndicatorTickSource } from './indicatorTickSource';
import { PaneDragWatcher } from './paneDragWatcher';

const NO_WORDS: IndicatorLegendWords = { shortTitle: '', inputs: '' };

/** What the chart owning the indicators tells them about itself. */
export interface ChartIndicatorsOptions {
  /** Every indicator a user can attach to this chart. */
  readonly definitions: readonly ChartIndicatorDefinition[];
  /** The legend's words for an attached indicator, e.g. "SMA" then "9 close". */
  readonly legendWords: (definitionId: string, settings: SettingValues) => IndicatorLegendWords;
  /** The bars the indicators are computed over. */
  readonly bars: () => readonly RenderBar[];
  /** The chart's own timeframe, which its indicators are told the bars are of. */
  readonly timeframe: () => string;
  /** The price decimals the legend writes its values with. */
  readonly digits: () => number;
  /** The chart's price series, handed to an indicator that pushes frames. */
  readonly priceSeries: ISeriesApi<'Candlestick'>;
  /** The chart's indicator selection: the layer draws its handles and the legend frames its row. */
  readonly selection: IndicatorSelection;
  /** Whether a drawing is the chart's selection: a click that picked one keeps it, as drawings win. */
  readonly drawingSelected: () => boolean;
  /** Whether the pointer rests on a plotted line the user can click, which the pane cursor follows. */
  readonly plotHoverChanged: (hovered: boolean) => void;
  /** Another timeframe's candles, which an indicator reads through this chart; omitted without a bridge. */
  readonly seriesSource?: IndicatorSeriesSource;
  /** The chart symbol's raw ticks, which an indicator reads through this chart; omitted without a bridge. */
  readonly tickSource?: IndicatorTickSource;
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
  private readonly chart: IChartApi;
  private readonly selection: IndicatorSelection;
  private readonly drawingSelected: ChartIndicatorsOptions['drawingSelected'];
  private readonly plotHoverChanged: ChartIndicatorsOptions['plotHoverChanged'];
  private readonly stopFollowingSelection: () => void;
  private readonly legend: IndicatorLegend;
  private readonly legendWords: ChartIndicatorsOptions['legendWords'];
  /** Whether the pointer rests on a plotted line the user can click, as the chart was last told. */
  private overPlot = false;
  /** The Status line tab's switches: which legend parts draw, and whether an indicator's inputs are named. */
  private statusLine = DEFAULT_STATUS_LINE_APPEARANCE;
  private readonly paneDragWatcher: PaneDragWatcher;

  constructor(
    chart: IChartApi,
    private readonly host: HTMLElement,
    options: ChartIndicatorsOptions,
  ) {
    this.chart = chart;
    this.selection = options.selection;
    this.drawingSelected = options.drawingSelected;
    this.plotHoverChanged = options.plotHoverChanged;
    this.legendWords = options.legendWords;
    this.hoveredBar = new HoveredBar(chart, options.bars);
    this.layer = new IndicatorLayer(chart);
    this.runtime = new IndicatorRuntime(
      this.layer,
      options.definitions,
      options.bars,
      options.timeframe,
      () => this.attachedStateChanged(),
      options.priceSeries,
      options.seriesSource,
      options.tickSource,
    );
    this.legend = new IndicatorLegend(
      host,
      {
        rows: (hoveredIndex) =>
          this.runtime.attachedState().map((attached) => ({
            instanceId: attached.instanceId,
            words: this.wordsOf(attached.definitionId, attached.settings),
            hidden: attached.hidden,
            selected: this.selection.selected() === attached.instanceId,
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
        openActionsMenu: (instanceId, anchor) => this.commands?.openActionsMenu(instanceId, anchor),
        setPaneHeights: (heights) => this.commands?.setPaneHeights(heights),
        setLegendCollapsed: (collapsed) => this.commands?.setLegendCollapsed(collapsed),
      },
    );
    this.hoveredBar.subscribe(() => this.legend.refresh());
    this.stopFollowingSelection = this.selection.subscribe(this.selectionChanged);
    this.chart.subscribeClick(this.paneClicked);
    // The chart reports where the pointer rests — its pane and the point in it — so a move measures no pane.
    this.chart.subscribeCrosshairMove(this.pointerMoved);
    host.addEventListener('pointerleave', this.pointerLeft);
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
    this.chart.unsubscribeClick(this.paneClicked);
    this.chart.unsubscribeCrosshairMove(this.pointerMoved);
    this.host.removeEventListener('pointerleave', this.pointerLeft);
    this.stopFollowingSelection();
    this.paneDragWatcher.destroy();
    this.hoveredBar.destroy();
    this.legend.destroy();
    // The runtime before the layer it draws through, as the controller tore them down.
    this.runtime.destroy();
    this.layer.destroy();
  }

  /**
   * A click on the pane picks the plot line under the pointer, the way a click on a drawing picks that
   * drawing: one the tool set has just selected keeps the selection, and a click on nothing clears it.
   */
  private readonly paneClicked = (param: MouseEventParams<Time>): void => {
    if (this.drawingSelected()) {
      return;
    }
    const pickedInstanceId = this.plotUnderPointer(param);
    if (pickedInstanceId === null) {
      this.selection.clear();
      return;
    }
    this.selection.select(pickedInstanceId);
  };

  /** Points the cursor at the plot line the pointer rests on, and off it once it rests on none. */
  private readonly pointerMoved = (param: MouseEventParams<Time>): void => {
    this.setOverPlot(this.plotUnderPointer(param) !== null);
  };

  /** The pointer left the chart: the cursor comes back, whatever the library last reported. */
  private readonly pointerLeft = (): void => {
    this.setOverPlot(false);
  };

  /** Tells the chart the pointer belongs to a plot line; a move that changes nothing tells it nothing. */
  private setOverPlot(overPlot: boolean): void {
    if (this.overPlot === overPlot) {
      return;
    }
    this.overPlot = overPlot;
    this.plotHoverChanged(overPlot);
  }

  /** The indicator whose plotted line rests under the pointer the chart reported, or null when none does. */
  private plotUnderPointer(param: MouseEventParams<Time>): string | null {
    const point = panePointOf(param);
    return point === null ? null : this.layer.indicatorAt(point);
  }

  /** The selection moved: the layer's handles follow it and the legend frames its row. */
  private readonly selectionChanged = (): void => {
    this.layer.setSelected(this.selection.selected());
    this.legend.refresh();
  };

  /** The attached indicators changed: a selection the chart no longer draws clears, and the rows follow. */
  private attachedStateChanged(): void {
    this.selection.dropUnattached(this.runtime.attachedState().map(({ instanceId }) => instanceId));
    this.legend.refresh();
  }

  /** The legend's words for an attached indicator: empty while the status line shows no titles. */
  private wordsOf(definitionId: string, settings: SettingValues): IndicatorLegendWords {
    if (!this.statusLine.indicatorTitles) {
      return NO_WORDS;
    }
    const namedSettings = this.statusLine.indicatorInputs ? settings : withoutStatusLineInputs(settings);
    return this.legendWords(definitionId, namedSettings);
  }

  /** The values the legend writes after `instanceId`'s words: none while the status line shows no values. */
  private legendValuesOf(instanceId: string, settings: SettingValues, barIndex: number): IndicatorLegendValue[] {
    if (!this.statusLine.indicatorValues || !indicatorDisplayOf(settings).valuesInStatusLine) {
      return [];
    }
    return this.layer.valuesAt(instanceId, barIndex);
  }
}
