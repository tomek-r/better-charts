import type { IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer, Time } from 'lightweight-charts';

const OVERLAY_CLASS = 'chart-indicator-pane-overlay';
const OVERLAY_LABEL = 'Indicator pane legend';
const BAND_CLASS = 'chart-pane-separator-band';
const SEPARATOR_COLSPAN = '3';

/** The cell of the separator row sitting above the pane whose content wrapper is `wrapper`. */
function separatorCellAbove(wrapper: HTMLElement): HTMLElement | null {
  const separatorRow = wrapper.parentElement?.parentElement?.previousElementSibling;
  const cell = separatorRow?.firstElementChild;
  if (!(cell instanceof HTMLElement) || cell.getAttribute('colspan') !== SEPARATOR_COLSPAN) {
    return null;
  }
  return cell;
}

/**
 * The top border of an indicator pane, the host of the legend row that pane owns, and the hover band
 * of the separator above the pane.
 *
 * The library paints its pane separator, and the band it shows on hover, across the left scale, the
 * pane and the right scale, so the separator is made transparent and every own pane draws this
 * border and this band across the pane area only.
 *
 * The elements are placed lazily from `draw`: a new pane's DOM exists only after the next paint, and
 * the widget re-binds panes when one above them goes, so the wrapper is checked on every draw.
 */
export class IndicatorPaneOverlay implements IPanePrimitive<Time> {
  readonly element: HTMLDivElement;
  private readonly band: HTMLDivElement;
  private readonly borderColor: () => string;
  private readonly views: readonly IPanePrimitivePaneView[];

  constructor(borderColor: () => string) {
    this.borderColor = borderColor;
    this.element = document.createElement('div');
    this.element.className = OVERLAY_CLASS;
    this.element.setAttribute('aria-label', OVERLAY_LABEL);
    this.band = document.createElement('div');
    this.band.className = BAND_CLASS;
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context }) => this.place(context.canvas.parentElement));
      },
    };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
  }

  // The library caches views by array identity, so the same array comes back every time.
  paneViews(): readonly IPanePrimitivePaneView[] {
    return this.views;
  }

  detached(): void {
    this.element.remove();
    this.band.remove();
  }

  /** Puts the overlay and the band in the DOM of the pane it is drawn in. */
  place(wrapper: HTMLElement | null): void {
    if (wrapper === null) {
      return;
    }
    if (this.element.parentElement !== wrapper) {
      wrapper.append(this.element);
    }
    // Read on every paint so the border follows the appearance settings.
    this.element.style.borderTopColor = this.borderColor();
    this.placeBand(wrapper);
  }

  /** Puts the band in the separator above the pane, spanning the pane's width only. */
  private placeBand(wrapper: HTMLElement): void {
    const cell = separatorCellAbove(wrapper);
    const paneCell = wrapper.parentElement;
    if (cell === null || paneCell === null) {
      return;
    }
    // Appended last in the cell, so it follows the library's resize handle for the hover rule.
    if (this.band.parentElement !== cell) {
      cell.append(this.band);
    }
    this.band.style.left = `${paneCell.offsetLeft}px`;
    this.band.style.width = `${wrapper.clientWidth}px`;
  }
}
