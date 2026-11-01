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
 * The settings gear in the corner where the price axis meets the time axis.
 *
 * It is an ordinary HTML button for the same reason as the A/L toggles: the library paints both axes on
 * its own canvas, which no button can be clicked on or reached through. Its box is the axis column's
 * width by the time axis's height, so it sits in the corner the two axes make; CSS paints and centres it.
 */
export class ChartSettingsCornerButton {
  private readonly button: HTMLButtonElement;

  constructor(
    host: HTMLElement,
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

  /** Re-measures both axes: they change with the pane's size, and with the width of the price labels. */
  sync(): void {
    const width = `${this.chart.priceScale(PRICE_SCALE_ID).width()}px`;
    const height = `${this.chart.timeScale().height()}px`;
    if (this.button.style.width !== width) {
      this.button.style.width = width;
    }
    if (this.button.style.height !== height) {
      this.button.style.height = height;
    }
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
