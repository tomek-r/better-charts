import { PriceScaleMode, type IChartApi, type IPriceScaleApi } from 'lightweight-charts';
import type { ScaleButtonsMode } from '../surface/chartScalesAppearance';
import { PaneScaleRow, type PaneScaleLabels } from './paneScaleRow';
import { PRICE_SCALE_ID } from './priceScaleId';
import { otherModeOf, writeScaleMode } from './priceScaleMode';

/** An indicator pane's own scale is not a saved setting: its choices last until the chart is reloaded. */
const INDICATOR_PANE_LABELS: PaneScaleLabels = {
  group: 'Indicator price scale',
  auto: 'Auto scale — fit this pane',
  log: 'Logarithmic scale for this pane',
};

/** The price pane is index 0, so the indicator panes' rows start after it. */
const FIRST_INDICATOR_PANE_INDEX = 1;

/**
 * The `A` / `L` rows of the indicator panes, one per pane after the price pane. Each writes its own
 * pane's scale directly, which is not a saved setting, and then reports that a scale was written.
 */
export class IndicatorPaneRows {
  private readonly rows: PaneScaleRow[] = [];
  /** The axis mask colour, kept so a row created later is painted like the ones already there. */
  private maskColor: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private modeButtons: ScaleButtonsMode,
    private readonly scaleWritten: () => void,
  ) {}

  /** Every indicator row in pane order, so a row's index in the list is its pane's, less the price pane. */
  all(): readonly PaneScaleRow[] {
    return this.rows;
  }

  /** One row per indicator pane, as many as the chart lists panes after the price pane. */
  matchPaneCount(): void {
    const extraPanes = Math.max(this.chart.panes().length - FIRST_INDICATOR_PANE_INDEX, 0);
    while (this.rows.length > extraPanes) {
      this.rows.pop()?.destroy();
    }
    while (this.rows.length < extraPanes) {
      this.rows.push(this.createRow(this.rows.length + FIRST_INDICATOR_PANE_INDEX));
    }
  }

  /** What the Scale modes setting asks of these rows, the ones created later included. */
  setModeButtons(mode: ScaleButtonsMode): void {
    this.modeButtons = mode;
    this.rows.forEach((row) => row.setModeButtons(mode));
  }

  /** Keeps the mask colour for the rows created later, and paints the ones already there. */
  setMaskColor(color: string | null): void {
    this.maskColor = color;
    this.rows.forEach((row) => row.setMaskColor(color));
  }

  /**
   * Puts every indicator pane's scale back on the view its pane opens on: fitting its own data, in the
   * regular spacing.
   */
  resetScales(): void {
    const lastPaneIndex = FIRST_INDICATOR_PANE_INDEX + this.rows.length - 1;
    for (let paneIndex = FIRST_INDICATOR_PANE_INDEX; paneIndex <= lastPaneIndex; paneIndex += 1) {
      const scale = this.scaleOf(paneIndex);
      scale?.applyOptions({ autoScale: true, mode: PriceScaleMode.Normal });
    }
  }

  destroy(): void {
    this.rows.forEach((row) => row.destroy());
  }

  private createRow(paneIndex: number): PaneScaleRow {
    const row = new PaneScaleRow(
      this.host,
      INDICATOR_PANE_LABELS,
      () => this.toggleAutoScale(paneIndex),
      () => this.switchMode(paneIndex),
    );
    row.setModeButtons(this.modeButtons);
    row.setMaskColor(this.maskColor);
    return row;
  }

  /** A pane's own right scale; an indicator pane's, since the price pane's row is not one of these. */
  private scaleOf(paneIndex: number): IPriceScaleApi | undefined {
    return this.chart.panes()[paneIndex]?.priceScale(PRICE_SCALE_ID);
  }

  /** An indicator pane's `A`: that pane's own scale is not saved, so its row writes the scale directly. */
  private toggleAutoScale(paneIndex: number): void {
    const scale = this.scaleOf(paneIndex);
    if (scale === undefined) {
      return;
    }
    scale.applyOptions({ autoScale: !scale.options().autoScale });
    this.scaleWritten();
  }

  /**
   * An indicator pane's `L`: the other mode, written straight to that pane's scale, with a manual range
   * carried over through the pane's first series, as the price pane's own switch does.
   */
  private switchMode(paneIndex: number): void {
    const pane = this.chart.panes()[paneIndex];
    const scale = this.scaleOf(paneIndex);
    if (pane === undefined || scale === undefined) {
      return;
    }
    writeScaleMode(scale, pane.getSeries()[0], otherModeOf(scale));
    this.scaleWritten();
  }
}
