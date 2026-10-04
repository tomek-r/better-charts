import type { RenderBar } from './mt5DataAdapter';

/**
 * The OHLC readout in the chart's top-left corner. It owns the `.chart-legend`
 * container as well as the text, so the other chart chrome can mount inside it
 * and disappear with it.
 *
 * `aria-label` is deliberately part of this element: the e2e suite selects the
 * legend by it.
 */
export class OhlcLegend {
  private readonly element: HTMLDivElement;
  private readonly text: HTMLSpanElement;

  constructor(host: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'chart-legend';
    this.element.setAttribute('aria-label', 'Candle OHLC');
    this.text = document.createElement('span');
    this.element.append(this.text);
    host.appendChild(this.element);
  }

  /** The container mounted chrome is appended to, so it is removed with the legend. */
  container(): HTMLElement {
    return this.element;
  }

  apply(symbol: string, bar: RenderBar | undefined, digits: number): void {
    if (!bar) {
      this.text.textContent = '';
      return;
    }
    this.text.textContent = `${symbol}  O ${bar.open.toFixed(digits)}  H ${bar.high.toFixed(digits)}  L ${bar.low.toFixed(digits)}  C ${bar.close.toFixed(digits)}`;
  }

  destroy(): void {
    this.element.remove();
  }
}
