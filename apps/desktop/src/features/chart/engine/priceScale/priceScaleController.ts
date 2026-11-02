import { PriceScaleMode, type IChartApi, type IPriceScaleApi, type ISeriesApi } from 'lightweight-charts';
import type { ScaleButtonsMode } from '../surface/chartScalesAppearance';
import { ChartSettingsCornerButton } from './chartSettingsCornerButton';
import { setPriceScaleRange } from './priceScaleRange';

/** The scale the candles and the price axis are bound to. */
const PRICE_SCALE_ID = 'right';

function control(glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = glyph;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function setPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
  button.classList.toggle('price-scale-control-on', pressed);
}

/**
 * Toggles on the right price scale: `A` fits the visible data (auto scale) and
 * `L` switches the scale to logarithmic prices. The settings gear sits below
 * them, in the corner where the price axis meets the time axis.
 *
 * Both are ordinary HTML buttons in the axis column rather than a primitive:
 * the library paints the axis on its own canvas and gives plugins no hit
 * testing, cursor or focus there, so a drawn button could not be clicked with
 * the mouse or reached with the keyboard. By default the row is revealed by a
 * pointer hit test built from public geometry only — the axis width
 * (`IPriceScaleApi.width()`) and the pane height — which is also the region
 * Lightweight Charts itself treats as the price scale, so the toggles appear
 * exactly where the axis is. The Scale modes setting keeps it on screen, or
 * takes it away.
 *
 * The toggles are price-scale options, so their pressed state is read back from
 * the scale instead of being cached: the library changes those options on its
 * own too, by turning auto scale off when the axis is dragged and on again when
 * it is double-clicked.
 *
 * Position and paint are CSS (`.price-scale-controls` in features/chart/engine/priceScale/price-scale-controls.css). Only
 * the row's width is set here, because the axis width is runtime geometry.
 */
export class PriceScaleController {
  private readonly axis: IPriceScaleApi;
  private readonly root: HTMLDivElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly logButton: HTMLButtonElement;
  private readonly settingsButton: ChartSettingsCornerButton;
  private revealed = false;
  /** How the row reaches the screen: revealed by the pointer, kept on screen, or never drawn. */
  private modeButtons: ScaleButtonsMode = 'mouseOver';

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
    private readonly candles: ISeriesApi<'Candlestick'>,
  ) {
    this.axis = chart.priceScale(PRICE_SCALE_ID);
    this.root = document.createElement('div');
    this.root.className = 'price-scale-controls';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Price scale');
    this.autoButton = control('A', 'Auto scale — fit the visible data to the pane');
    this.logButton = control('L', 'Logarithmic price scale');
    this.autoButton.addEventListener('click', this.toggleAutoScale);
    this.logButton.addEventListener('click', this.toggleLogarithmic);
    this.root.append(this.autoButton, this.logButton);
    host.appendChild(this.root);
    host.addEventListener('pointermove', this.onPointerMove);
    // Touch has no hover, so the same hit test also runs on press: a tap on the
    // axis reveals the toggles, and the next tap on one of them toggles it.
    host.addEventListener('pointerdown', this.onPointerMove);
    host.addEventListener('pointerleave', this.onPointerLeave);
    // The library resets a dragged scale from the same pointer gestures, so the
    // row is re-read when one ends instead of trusting the state it last wrote.
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('dblclick', this.onDoubleClick);
    this.settingsButton = new ChartSettingsCornerButton(host, chart);
    this.sync();
  }

  /** Re-reads the scale. Call after changing it anywhere else (e.g. resetView). */
  sync(): void {
    const options = this.axis.options();
    const logarithmic = options.mode === PriceScaleMode.Logarithmic;
    setPressed(this.autoButton, options.autoScale);
    setPressed(this.logButton, logarithmic);
    if (this.modeButtons === 'always') {
      this.setWidth(this.axis.width());
    }
  }

  /**
   * What the Scale modes setting asks of the row: `mouseOver` reveals it while the pointer is over the
   * axis, `always` keeps it on screen, and `hidden` removes it — a `hidden` element takes no pointer
   * press and no focus, so the toggles cannot be reached at all.
   */
  setScaleModeButtons(mode: ScaleButtonsMode): void {
    if (mode === this.modeButtons) {
      return;
    }
    this.modeButtons = mode;
    this.root.hidden = mode === 'hidden';
    this.root.classList.toggle('price-scale-controls-always', mode === 'always');
    // A row kept on screen masks the axis labels from the start; a revealed one is measured by the hit test.
    if (mode === 'always') {
      this.setWidth(this.axis.width());
    }
    this.conceal();
  }

  /** The mode the row is drawn with, which the dev test hook reads back. */
  scaleModeButtons(): ScaleButtonsMode {
    return this.modeButtons;
  }

  /** Re-measures the gear on the axes' geometry. Call wherever the pane or the price labels changed. */
  syncSettingsButton(): void {
    this.settingsButton.sync();
  }

  /**
   * Fills the row's box with the chart's own background colour. That fill is what masks the axis
   * labels behind the toggles (see price-scale-controls.css), so it takes the background the chart
   * is drawn on, a gradient's top colour included, and it must be opaque to hide the labels.
   * `null` drops the inline colour, leaving the row painted by its opaque CSS default.
   */
  setMaskColor(color: string | null): void {
    this.root.style.backgroundColor = color ?? '';
  }

  destroy(): void {
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerdown', this.onPointerMove);
    this.host.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('dblclick', this.onDoubleClick);
    this.autoButton.removeEventListener('click', this.toggleAutoScale);
    this.logButton.removeEventListener('click', this.toggleLogarithmic);
    this.settingsButton.destroy();
    this.root.remove();
  }

  private readonly toggleAutoScale = (): void => {
    this.axis.applyOptions({ autoScale: !this.axis.options().autoScale });
    this.sync();
  };

  private readonly toggleLogarithmic = (): void => {
    const mode = this.axis.options().mode;
    const range = this.axis.options().autoScale ? null : this.axis.getVisibleRange();
    this.axis.applyOptions({
      mode: mode === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic,
    });
    // Preserve the actual-price range across LWC's manual mode switch.
    if (range !== null) {
      setPriceScaleRange(this.candles, range);
    }
    this.sync();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.revealsOnHover()) {
      return;
    }
    const width = this.axisWidthUnderPointer(event);
    if (width === 0) {
      this.conceal();
      return;
    }
    this.setWidth(width);
    this.reveal();
  };

  private readonly onPointerLeave = (): void => {
    if (!this.revealsOnHover()) {
      return;
    }
    this.conceal();
  };

  private readonly onPointerUp = (): void => {
    if (this.revealed) {
      this.sync();
    }
  };

  private readonly onDoubleClick = (): void => {
    if (this.revealed) {
      this.sync();
    }
  };

  /**
   * Axis width while the pointer is over the right price scale, otherwise 0:
   * the last `width()` pixels of the host, down to the end of the pane (the
   * time axis below it is not the price scale). Invisible scales report width
   * 0, and the toggles stay out of the way of an empty chart.
   */
  private axisWidthUnderPointer(event: PointerEvent): number {
    const width = this.axis.width();
    if (width <= 0) {
      return 0;
    }
    const bounds = this.host.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const over = x >= bounds.width - width && x <= bounds.width && y >= 0 && y <= this.paneHeight();
    return over ? width : 0;
  }

  /**
   * Matches the row to the axis width, so its fill masks the whole axis column.
   * Re-read on every reveal, because the axis widens with the price labels.
   */
  private setWidth(width: number): void {
    const next = `${width}px`;
    if (this.root.style.width !== next) {
      this.root.style.width = next;
    }
  }

  private paneHeight(): number {
    return this.chart.panes()[0]?.getHeight() ?? this.host.clientHeight;
  }

  /** Only the mouse-over row follows the pointer; the other two modes draw a row that never moves. */
  private revealsOnHover(): boolean {
    return this.modeButtons === 'mouseOver';
  }

  private reveal(): void {
    if (this.revealed) {
      return;
    }
    this.revealed = true;
    this.sync();
    this.root.classList.add('price-scale-controls-revealed');
  }

  private conceal(): void {
    if (!this.revealed) {
      return;
    }
    this.revealed = false;
    this.root.classList.remove('price-scale-controls-revealed');
  }
}
