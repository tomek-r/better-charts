import type { RenderBar } from '../bars/renderBar';

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

  apply(symbol: string, bar: RenderBar | undefined, digits: number, valueColor: string | null): void {
    if (!bar) {
      this.text.textContent = '';
      return;
    }
    this.text.replaceChildren(
      `${symbol}  O `,
      this.value(bar.open, digits, valueColor),
      '  H ',
      this.value(bar.high, digits, valueColor),
      '  L ',
      this.value(bar.low, digits, valueColor),
      '  C ',
      this.value(bar.close, digits, valueColor),
    );
  }

  /** One price as its own span, so the numbers take the bar's body colour and the labels keep theirs. */
  private value(price: number, digits: number, color: string | null): HTMLSpanElement {
    const value = document.createElement('span');
    value.className = 'chart-legend-value';
    value.textContent = price.toFixed(digits);
    value.style.color = color ?? '';
    return value;
  }

  destroy(): void {
    this.element.remove();
  }
}
