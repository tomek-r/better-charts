import type { IChartApi } from 'lightweight-charts';
import { SETTINGS_ICON_PATH } from '../../../../shared/ui/icons/SettingsIcon';

/**
 * The event the gear raises on the chart's host when it is pressed. The settings dialog's host listens
 * for it, so the engine asks for the dialog without ever holding a React callback.
 */
export const CHART_SETTINGS_REQUESTED_EVENT = 'chart-settings-requested';

/** The scale the gear is measured against: the one the price axis and the candles are bound to. */
const PRICE_SCALE_ID = 'right';

/** The square OutlineIcon draws in, which the gear the settings menu shows is drawn in too. */
const GEAR_VIEW_BOX = '0 0 24 24';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const BUTTON_LABEL = 'Chart settings';

/** The border the library paints on the price axis' left edge and on the time axis' top edge. */
const AXIS_BORDER_PX = 1;

/** The gear glyph: the same outline `SettingsIcon` renders, as an element the DOM button can hold. */
function gearGlyph(): SVGSVGElement {
  const glyph = document.createElementNS(SVG_NAMESPACE, 'svg');
  glyph.setAttribute('viewBox', GEAR_VIEW_BOX);
  glyph.setAttribute('aria-hidden', 'true');
  glyph.setAttribute('focusable', 'false');
  const outline = document.createElementNS(SVG_NAMESPACE, 'path');
  outline.setAttribute('d', SETTINGS_ICON_PATH);
  glyph.append(outline);
  return glyph;
}

/**
 * Writes one edge of the button's box, in CSS pixels from the host's corner. Nothing below zero is
 * written: an axis the chart hides reports no width or height, and a collapsed box reads as absent
 * instead of being drawn backwards over the chart.
 */
function setEdge(button: HTMLButtonElement, edge: 'left' | 'top' | 'width' | 'height', pixels: number): void {
  const next = `${Math.max(0, pixels)}px`;
  if (button.style[edge] !== next) {
    button.style[edge] = next;
  }
}

/**
 * The settings gear in the corner where the price axis meets the time axis.
 *
 * It is an ordinary HTML button for the same reason as the A/L toggles: the library paints both axes on
 * its own canvas, which no button can be clicked on or reached through. Its box is the corner cell inside
 * the two axis borders — the axis column's width between the price axis' border line and the chart frame,
 * by the time axis' height between its own border line and the frame — so the rounded chip CSS paints
 * inside it is centred in that cell and covers neither axis line nor the frame's rounded corner.
 */
export class ChartSettingsCornerButton {
  private readonly button: HTMLButtonElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly chart: IChartApi,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'chart-settings-corner-button';
    this.button.title = BUTTON_LABEL;
    this.button.setAttribute('aria-label', BUTTON_LABEL);
    this.button.append(gearGlyph());
    this.button.addEventListener('click', this.requestSettings);
    host.appendChild(this.button);
    this.sync();
  }

  /**
   * Re-measures the corner cell on both axes: they change with the pane's size, and the price axis also
   * with the width of its labels. The cell is measured from the frame's right and bottom edges inwards,
   * which is where the axes themselves end, and each side stops one border line short of an axis edge.
   * Every edge is snapped inwards to whole pixels — the left and top edges round up, the width and height
   * round down — so a fraction of a pixel in the axes' geometry can never cover a border line or reach
   * past the frame.
   */
  sync(): void {
    const { width: hostWidth, height: hostHeight } = this.host.getBoundingClientRect();
    const axisWidth = this.chart.priceScale(PRICE_SCALE_ID).width();
    const timeAxisHeight = this.chart.timeScale().height();
    setEdge(this.button, 'left', Math.ceil(hostWidth - axisWidth + AXIS_BORDER_PX));
    setEdge(this.button, 'top', Math.ceil(hostHeight - timeAxisHeight + AXIS_BORDER_PX));
    setEdge(this.button, 'width', Math.floor(axisWidth) - AXIS_BORDER_PX);
    setEdge(this.button, 'height', Math.floor(timeAxisHeight) - AXIS_BORDER_PX);
  }

  destroy(): void {
    this.button.removeEventListener('click', this.requestSettings);
    this.button.remove();
  }

  /** The press travels up to the chart's host as an event, which is the only way out of the engine. */
  private readonly requestSettings = (): void => {
    this.button.dispatchEvent(new Event(CHART_SETTINGS_REQUESTED_EVENT, { bubbles: true }));
  };
}
