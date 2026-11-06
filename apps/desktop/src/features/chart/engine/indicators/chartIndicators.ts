import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import { IndicatorLegend, type IndicatorLegendCommands } from '../legend/indicatorLegend';
import type { SettingValues } from '../settings/settingInputs';
import type { ChartIndicatorDefinition } from './indicatorContract';
import { indicatorDisplayOf, withoutStatusLineInputs } from './indicatorDisplaySettings';
import { DEFAULT_STATUS_LINE_APPEARANCE, type ChartStatusLineAppearance } from '../legend/statusLineAppearance';
import { IndicatorLayer, type IndicatorLegendValue, type IndicatorPaneHeight } from './indicatorLayer';
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
 * The heights `resized` gives differently from `snapshot`, which is what the user dragged. An entry the
 * snapshot does not hold appeared during the drag and is left alone: it was never on screen to resize.
 */
function draggedPaneHeights(
  snapshot: readonly IndicatorPaneHeight[],
  resized: readonly IndicatorPaneHeight[],
): IndicatorPaneHeight[] {
  const heightsBefore = new Map(snapshot.map((entry) => [entry.instanceId, entry.paneHeight]));
  return resized.filter((entry) => {
    const before = heightsBefore.get(entry.instanceId);
    return before !== undefined && before !== entry.paneHeight;
  });
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
  private readonly legendTitle: ChartIndicatorsOptions['legendTitle'];
  /** The Status line tab's switches: which legend parts draw, and whether an indicator's inputs are named. */
  private statusLine = DEFAULT_STATUS_LINE_APPEARANCE;
  /** The pane heights when the pointer went down; null while no drag is watched and none just ended. */
  private paneHeightsBeforeDrag: readonly IndicatorPaneHeight[] | null = null;
  private readonly crosshairMoved = (param: MouseEventParams<Time>): void => {
    this.legend.crosshairMoved(param.logical ?? null);
  };
  /**
   * The pointer going down anywhere on the chart may start a drag of a pane separator, which only the
   * library knows about: the heights are snapshotted here and compared when the pointer comes up.
   */
  private readonly pointerDown = (): void => {
    this.paneHeightsBeforeDrag = this.layer.paneHeights();
    window.addEventListener('pointerup', this.pointerReleased);
    window.addEventListener('pointercancel', this.pointerReleased);
  };
  private readonly pointerReleased = (): void => {
    const snapshot = this.paneHeightsBeforeDrag;
    this.stopWatchingDrag();
    if (snapshot === null) {
      return;
    }
    const dragged = draggedPaneHeights(snapshot, this.layer.paneHeights());
    if (dragged.length > 0) {
      this.commands?.setPaneHeights(dragged);
    }
  };

  constructor(
    private readonly chart: IChartApi,
    private readonly host: HTMLElement,
    options: ChartIndicatorsOptions,
  ) {
    this.legendTitle = options.legendTitle;
    this.layer = new IndicatorLayer(chart);
    this.runtime = new IndicatorRuntime(this.layer, options.definitions, options.bars, () => this.legend.refresh());
    this.legend = new IndicatorLegend(
      host,
      {
        rows: (logicalIndex) =>
          this.runtime.attachedState().map((attached) => ({
            instanceId: attached.instanceId,
            title: this.titleOf(attached.definitionId, attached.settings),
            hidden: attached.hidden,
            digits: this.layer.precisionOf(attached.instanceId),
            values: this.legendValuesOf(attached.instanceId, attached.settings, logicalIndex),
            paneHost: this.layer.paneLegendHost(attached.instanceId),
          })),
        lastBarIndex: () => options.bars().length - 1,
        digits: options.digits,
      },
      {
        openSettings: (instanceId) => this.commands?.openSettings(instanceId),
        setHidden: (instanceId, hidden) => this.commands?.setHidden(instanceId, hidden),
        remove: (instanceId) => this.commands?.remove(instanceId),
        setPaneHeights: (heights) => this.commands?.setPaneHeights(heights),
      },
    );
    this.chart.subscribeCrosshairMove(this.crosshairMoved);
    // The capture phase sees the pointer before the library's separator handle takes it for its drag.
    this.host.addEventListener('pointerdown', this.pointerDown, true);
  }

  /** Takes the commands the legend's row buttons forward to, or null to drop them. */
  setCommands(commands: IndicatorLegendCommands | null): void {
    this.commands = commands;
  }

  /** Applies the Status line tab's switches to the legend rows and redraws them. */
  setStatusLine(appearance: ChartStatusLineAppearance): void {
    this.statusLine = appearance;
    this.legend.refresh();
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.pointerDown, true);
    this.stopWatchingDrag();
    this.chart.unsubscribeCrosshairMove(this.crosshairMoved);
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
  private legendValuesOf(instanceId: string, settings: SettingValues, logicalIndex: number): IndicatorLegendValue[] {
    if (!this.statusLine.indicatorValues || !indicatorDisplayOf(settings).valuesInStatusLine) {
      return [];
    }
    return this.layer.valuesAt(instanceId, logicalIndex);
  }

  /** Stops watching for the end of a drag the pointer may never finish. */
  private stopWatchingDrag(): void {
    this.paneHeightsBeforeDrag = null;
    window.removeEventListener('pointerup', this.pointerReleased);
    window.removeEventListener('pointercancel', this.pointerReleased);
  }
}
