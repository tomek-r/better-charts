import type { RenderBar } from '../bars/renderBar';

/** Everything the OHLC line draws, already resolved and formatted; the legend does no calculation. */
export interface OhlcLegendView {
  readonly title: string | null;
  readonly bar: RenderBar | undefined;
  readonly digits: number;
  readonly chartValues: boolean;
  readonly valueColor: string | null;
  readonly barChange: string | null;
  readonly volume: string | null;
  readonly lastDayChange: { readonly text: string; readonly color: string } | null;
}

type LegendSegment = string | HTMLElement;

const SEGMENT_SEPARATOR = '  ';
const PRICE_VALUE_CLASS = 'chart-legend-value';
const VOLUME_VALUE_CLASS = 'chart-legend-volume';
const CHANGE_CLASS = 'chart-legend-change';

/** Joins the on segments, keeping the two-space gap that separates one readout from the next. */
function joined(groups: readonly (readonly LegendSegment[])[]): LegendSegment[] {
  const segments: LegendSegment[] = [];
  for (const group of groups) {
    if (segments.length > 0) {
      segments.push(SEGMENT_SEPARATOR);
    }
    segments.push(...group);
  }
  return segments;
}

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

  apply(view: OhlcLegendView): void {
    const { bar } = view;
    if (!bar) {
      this.text.textContent = '';
      return;
    }
    this.text.replaceChildren(...joined(this.segmentGroups(view, bar)));
  }

  private segmentGroups(view: OhlcLegendView, bar: RenderBar): LegendSegment[][] {
    const groups: LegendSegment[][] = [];
    if (view.title !== null) {
      groups.push([view.title]);
    }
    if (view.chartValues) {
      groups.push(...this.priceGroups(bar, view.digits, view.valueColor));
    }
    if (view.barChange !== null) {
      groups.push([this.span(CHANGE_CLASS, view.barChange, view.valueColor)]);
    }
    if (view.volume !== null) {
      groups.push(['Vol ', this.span(VOLUME_VALUE_CLASS, view.volume, view.valueColor)]);
    }
    if (view.lastDayChange !== null) {
      groups.push(['Day ', this.span(CHANGE_CLASS, view.lastDayChange.text, view.lastDayChange.color)]);
    }
    return groups;
  }

  /** The four prices as their own spans, so the numbers take the bar's body colour and the labels keep theirs. */
  private priceGroups(bar: RenderBar, digits: number, color: string | null): LegendSegment[][] {
    return [
      ['O ', this.span(PRICE_VALUE_CLASS, bar.open.toFixed(digits), color)],
      ['H ', this.span(PRICE_VALUE_CLASS, bar.high.toFixed(digits), color)],
      ['L ', this.span(PRICE_VALUE_CLASS, bar.low.toFixed(digits), color)],
      ['C ', this.span(PRICE_VALUE_CLASS, bar.close.toFixed(digits), color)],
    ];
  }

  private span(className: string, text: string, color: string | null): HTMLSpanElement {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    element.style.color = color ?? '';
    return element;
  }

  destroy(): void {
    this.element.remove();
  }
}
