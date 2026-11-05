import type { IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer, Time } from 'lightweight-charts';

const OVERLAY_CLASS = 'chart-indicator-pane-overlay';
const OVERLAY_LABEL = 'Indicator pane legend';

/**
 * The top border of an indicator pane, and the host of the legend row that pane owns.
 *
 * The library paints its pane separator across the left scale, the pane and the right scale, so it
 * is made transparent and every own pane draws this border across the pane area only.
 *
 * The element is placed lazily from `draw`: a new pane's DOM exists only after the next paint, and
 * the widget re-binds panes when one above them goes, so the wrapper is checked on every draw.
 */
export class IndicatorPaneOverlay implements IPanePrimitive<Time> {
  readonly element: HTMLDivElement;
  private readonly borderColor: () => string;
  private readonly views: readonly IPanePrimitivePaneView[];

  constructor(borderColor: () => string) {
    this.borderColor = borderColor;
    this.element = document.createElement('div');
    this.element.className = OVERLAY_CLASS;
    this.element.setAttribute('aria-label', OVERLAY_LABEL);
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
  }

  /** Puts the overlay in the wrapper of the pane it is drawn in; nothing while that pane has no DOM. */
  place(wrapper: HTMLElement | null): void {
    if (wrapper === null) {
      return;
    }
    if (this.element.parentElement !== wrapper) {
      wrapper.append(this.element);
    }
    // Read on every paint so the border follows the appearance settings.
    this.element.style.borderTopColor = this.borderColor();
  }
}
