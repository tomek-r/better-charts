import { PriceScaleMode, type IChartApi, type IPriceScaleApi, type ISeriesApi } from 'lightweight-charts';
import { priceScaleModeOf, type ChartPriceScaleMode, type ScaleButtonsMode } from '../surface/chartScalesAppearance';
import { ChartSettingsCornerButton } from './chartSettingsCornerButton';
import { axisHitAt, type AxisHit } from './paneAxisHitTest';
import { PaneLayoutWatcher } from './paneLayoutWatcher';
import { PaneScaleRow, type PaneScaleLabels } from './paneScaleRow';
import { setPriceScaleRange } from './priceScaleRange';

/** The scale the candles and every pane's own prices are drawn against. */
const PRICE_SCALE_ID = 'right';

/** The panes list the price pane first, so its row comes first and is never removed. */
const PRICE_PANE_INDEX = 0;

const PRICE_PANE_LABELS: PaneScaleLabels = {
  group: 'Price scale',
  auto: 'Auto scale — fit the visible data to the pane',
  log: 'Logarithmic price scale',
};

/** An indicator pane's own scale is not a saved setting: its choices last until the chart is reloaded. */
const INDICATOR_PANE_LABELS: PaneScaleLabels = {
  group: 'Indicator price scale',
  auto: 'Auto scale — fit this pane',
  log: 'Logarithmic scale for this pane',
};

/**
 * The event the `L` toggle raises on the chart's host: the price scale mode it asks the chart to keep.
 * The mode is one of the chart's saved scales settings, so the toggle asks for it instead of writing it.
 */
export const PRICE_SCALE_MODE_REQUESTED_EVENT = 'chart-price-scale-mode-requested';

/** The event the scale raises on the chart's host whenever auto scale actually moves. */
export const PRICE_SCALE_AUTO_CHANGED_EVENT = 'chart-price-scale-auto-changed';

/** What the `L` toggle asks for: the mode the chart should draw the price scale in. */
export interface PriceScaleModeRequestDetail {
  readonly mode: ChartPriceScaleMode;
}

/** What the scale reports when auto scale moves: whether the scale now fits the visible data itself. */
export interface PriceScaleAutoDetail {
  readonly autoScale: boolean;
}

/** The saved shape of the price scale: which way its prices grow, and how they are spaced. */
export interface PriceScaleShape {
  readonly invertScale: boolean;
  readonly logarithmic: boolean;
}

/** The price scale as the chart draws it right now, which the gear menu and the app read back. */
export interface PriceScaleState extends PriceScaleShape {
  readonly autoScale: boolean;
}

/**
 * Every pane's `A` / `L` row: the price pane's own first, with the settings gear below it in the corner
 * where the price axis meets the time axis, then one row per indicator pane, each at the foot of that
 * pane's own axis. A row belongs to the pane it is placed on, so a pointer over one pane's axis reveals
 * that pane's row alone — the price pane's row sits above the indicator panes instead of beside the
 * whole chart's bottom edge.
 *
 * `A` and `L` on the price pane are what they always were: `A` fits the visible data, and `L` only asks
 * for the other mode, because the mode is a saved setting that the settings apply through
 * `setScaleShape`. The events travel up to the chart's host, which is the only way out of the engine.
 * An indicator pane's own rows write that pane's scale directly and are not saved, so nothing there
 * reaches the chart's settings.
 *
 * The rows are created and removed by comparing the chart's pane count, and every row is re-read and
 * re-placed from its pane's own geometry whenever the panes are laid out again.
 */
export class PriceScaleController {
  private readonly axis: IPriceScaleApi;
  private readonly priceRow: PaneScaleRow;
  private readonly indicatorRows: PaneScaleRow[] = [];
  private readonly settingsButton: ChartSettingsCornerButton;
  private readonly layout: PaneLayoutWatcher;
  /** How the rows reach the screen: revealed by the pointer, kept on screen, or never drawn. */
  private modeButtons: ScaleButtonsMode = 'mouseOver';
  /** The axis mask colour, kept so a row created later is painted like the ones already there. */
  private maskColor: string | null = null;
  /** The auto scale the app was last told about; only a real change is announced. */
  private autoScale = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private readonly candles: ISeriesApi<'Candlestick'>,
  ) {
    this.axis = chart.priceScale(PRICE_SCALE_ID);
    this.priceRow = new PaneScaleRow(host, PRICE_PANE_LABELS, this.toggleAutoScale, this.requestOtherMode);
    host.addEventListener('pointermove', this.onPointerMove);
    // Touch has no hover, so the same hit test also runs on press: a tap on the
    // axis reveals the toggles, and the next tap on one of them toggles it.
    host.addEventListener('pointerdown', this.onPointerMove);
    host.addEventListener('pointerleave', this.onPointerLeave);
    // The library resets a dragged scale from the same pointer gestures, so the
    // rows are re-read when one ends instead of trusting the state they last wrote.
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('dblclick', this.onDoubleClick);
    this.settingsButton = new ChartSettingsCornerButton(host, chart);
    this.layout = new PaneLayoutWatcher(host, chart, this.followPaneLayout);
    this.sync();
  }

  /** Re-reads every row from its own scale and re-places it on its pane. Call after changing the scale. */
  sync(): void {
    this.syncRows();
    this.rows().forEach((row, paneIndex) => this.syncRow(row, paneIndex));
  }

  /** Fits the visible data to the price pane, or stops doing so, whichever way the caller asks. */
  setAutoScale(on: boolean): void {
    if (this.axis.options().autoScale === on) {
      return;
    }
    this.axis.applyOptions({ autoScale: on });
    this.sync();
  }

  /**
   * The saved shape of the scale, each part written only when it differs from the scale's own. The
   * prices' spacing is the one write that has to carry the range over with it.
   */
  setScaleShape(shape: Readonly<PriceScaleShape>): void {
    const options = this.axis.options();
    if (options.invertScale !== shape.invertScale) {
      this.axis.applyOptions({ invertScale: shape.invertScale });
    }
    const mode = shape.logarithmic ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;
    if (options.mode !== mode) {
      this.applyMode(mode);
    }
    this.sync();
  }

  /** The scale as it is drawn now, which the gear menu offers to change and the app reads back. */
  scaleShape(): PriceScaleState {
    const options = this.axis.options();
    return {
      autoScale: options.autoScale,
      logarithmic: options.mode === PriceScaleMode.Logarithmic,
      invertScale: options.invertScale,
    };
  }

  /** What the Scale modes setting asks of every row, the ones created later included. */
  setScaleModeButtons(mode: ScaleButtonsMode): void {
    if (mode === this.modeButtons) {
      return;
    }
    this.modeButtons = mode;
    this.rows().forEach((row) => row.setModeButtons(mode));
    this.sync();
  }

  /** The mode the rows are drawn with, which the dev test hook reads back. */
  scaleModeButtons(): ScaleButtonsMode {
    return this.modeButtons;
  }

  /** Re-measures the gear on the axes' geometry and re-places the rows on their panes. */
  syncSettingsButton(): void {
    this.settingsButton.sync();
    this.sync();
  }

  /**
   * Fills every row's box with the chart's own background colour, keeping it for the rows created
   * later. That fill is what masks the axis labels behind the buttons, so it takes the background the
   * chart is drawn on, a gradient's top colour included, and it must be opaque to hide the labels.
   * `null` drops the inline colour, leaving the rows painted by their opaque CSS default.
   */
  setMaskColor(color: string | null): void {
    this.maskColor = color;
    this.rows().forEach((row) => row.setMaskColor(color));
  }

  destroy(): void {
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerdown', this.onPointerMove);
    this.host.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('dblclick', this.onDoubleClick);
    this.layout.destroy();
    this.priceRow.destroy();
    this.indicatorRows.forEach((row) => row.destroy());
    this.settingsButton.destroy();
  }

  /** Every row in pane order, so a row's index is its pane's. */
  private rows(): PaneScaleRow[] {
    return [this.priceRow, ...this.indicatorRows];
  }

  /** One row per pane: the price pane's first, then one per further pane, as the chart lists them. */
  private syncRows(): void {
    const extraPanes = Math.max(this.chart.panes().length - 1, 0);
    while (this.indicatorRows.length > extraPanes) {
      this.indicatorRows.pop()?.destroy();
    }
    while (this.indicatorRows.length < extraPanes) {
      this.indicatorRows.push(this.createIndicatorRow(this.indicatorRows.length + 1));
    }
    this.layout.watchPanes();
  }

  private createIndicatorRow(paneIndex: number): PaneScaleRow {
    const row = new PaneScaleRow(
      this.host,
      INDICATOR_PANE_LABELS,
      () => this.togglePaneAutoScale(paneIndex),
      () => this.switchPaneScaleMode(paneIndex),
    );
    row.setModeButtons(this.modeButtons);
    row.setMaskColor(this.maskColor);
    return row;
  }

  private syncRow(row: PaneScaleRow, paneIndex: number): void {
    const pane = this.chart.panes()[paneIndex];
    row.place(this.host, pane?.getHTMLElement() ?? null);
    const scale = this.scaleOf(paneIndex);
    if (scale === undefined) {
      return;
    }
    const options = scale.options();
    row.setPressed(options.autoScale, options.mode === PriceScaleMode.Logarithmic);
    if (this.modeButtons === 'always') {
      row.setWidth(scale.width());
    }
    if (paneIndex === PRICE_PANE_INDEX) {
      this.noticeAutoScale(options.autoScale);
    }
  }

  /** A pane's own right scale; the price pane's is the one the saved shape is written to. */
  private scaleOf(paneIndex: number): IPriceScaleApi | undefined {
    if (paneIndex === PRICE_PANE_INDEX) {
      return this.axis;
    }
    return this.chart.panes()[paneIndex]?.priceScale(PRICE_SCALE_ID);
  }

  private readonly toggleAutoScale = (): void => {
    this.setAutoScale(!this.axis.options().autoScale);
  };

  /** The mode is a saved setting, so the toggle asks the app for the other one and writes nothing itself. */
  private readonly requestOtherMode = (): void => {
    const mode = priceScaleModeOf(!this.scaleShape().logarithmic);
    const detail: PriceScaleModeRequestDetail = { mode };
    this.host.dispatchEvent(new CustomEvent(PRICE_SCALE_MODE_REQUESTED_EVENT, { bubbles: true, detail }));
  };

  /** An indicator pane's `A`: that pane's own scale is not saved, so its row writes the scale directly. */
  private togglePaneAutoScale(paneIndex: number): void {
    const scale = this.scaleOf(paneIndex);
    if (scale === undefined) {
      return;
    }
    scale.applyOptions({ autoScale: !scale.options().autoScale });
    this.sync();
  }

  /**
   * An indicator pane's `L`: the other mode, written straight to that pane's scale. A manual range is
   * written in the coordinates of the mode it was set in, so it is carried over through the pane's
   * first series, as the price pane's own switch does.
   */
  private switchPaneScaleMode(paneIndex: number): void {
    const pane = this.chart.panes()[paneIndex];
    const scale = this.scaleOf(paneIndex);
    if (pane === undefined || scale === undefined) {
      return;
    }
    const options = scale.options();
    const logarithmic = options.mode !== PriceScaleMode.Logarithmic;
    const range = options.autoScale ? null : scale.getVisibleRange();
    scale.applyOptions({ mode: logarithmic ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    const series = pane.getSeries()[0];
    if (range !== null && series !== undefined) {
      setPriceScaleRange(series, range);
    }
    this.sync();
  }

  /**
   * Writes the price pane's mode, holding the actual-price range across the library's own manual switch:
   * a manual range is written in the coordinates of the mode it was set in, so it would land elsewhere.
   */
  private applyMode(mode: PriceScaleMode): void {
    const range = this.axis.options().autoScale ? null : this.axis.getVisibleRange();
    this.axis.applyOptions({ mode });
    if (range !== null) {
      setPriceScaleRange(this.candles, range);
    }
  }

  /**
   * Announces auto scale moving, which the library also does on its own: dragging the axis turns it
   * off and double-clicking it turns it on. Only a real change is announced, so a re-read repeats none.
   */
  private noticeAutoScale(autoScale: boolean): void {
    if (autoScale === this.autoScale) {
      return;
    }
    this.autoScale = autoScale;
    const detail: PriceScaleAutoDetail = { autoScale };
    this.host.dispatchEvent(new CustomEvent(PRICE_SCALE_AUTO_CHANGED_EVENT, { bubbles: true, detail }));
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.revealsOnHover()) {
      return;
    }
    // Before the hit test, so a pane the chart has just split off already has the row it reveals.
    this.syncRows();
    const hit = axisHitAt(this.chart, this.host, event);
    this.rows().forEach((row, paneIndex) => this.hoverRow(row, paneIndex, hit));
  };

  /** Only the row of the pane the pointer's axis belongs to shows; every other row hides. */
  private hoverRow(row: PaneScaleRow, paneIndex: number, hit: AxisHit | null): void {
    if (hit === null || hit.paneIndex !== paneIndex) {
      row.conceal();
      return;
    }
    row.setWidth(hit.width);
    if (row.isRevealed()) {
      return;
    }
    row.reveal();
    this.syncRow(row, paneIndex);
  }

  private readonly onPointerLeave = (): void => {
    if (!this.revealsOnHover()) {
      return;
    }
    this.rows().forEach((row) => row.conceal());
  };

  private readonly onPointerUp = (): void => this.refreshRevealed();

  private readonly onDoubleClick = (): void => this.refreshRevealed();

  private refreshRevealed(): void {
    if (this.rows().some((row) => row.isRevealed())) {
      this.sync();
    }
  }

  /** Only the mouse-over rows follow the pointer; the rows of the other two modes never move. */
  private revealsOnHover(): boolean {
    return this.modeButtons === 'mouseOver';
  }

  /** The panes were laid out again: every row is placed from its own pane's geometry, so all re-read. */
  private readonly followPaneLayout = (): void => {
    this.sync();
  };
}
