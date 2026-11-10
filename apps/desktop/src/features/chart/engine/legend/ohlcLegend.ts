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
  readonly lastDayChange: { readonly text: string; readonly color: string | null } | null;
}

/** A run of the line written as it stands, such as a label or the gap between two readouts. */
interface LegendLabel {
  readonly kind: 'label';
  readonly text: string;
}

/** A value span, whose text and colour the hovered bar changes; its class names what it holds. */
interface LegendValue {
  readonly kind: 'value';
  readonly className: string;
  readonly text: string;
  readonly color: string | null;
}

type LegendSegment = LegendLabel | LegendValue;

/** A value span as the line holds it, with the value it was last written with. */
interface ShownValue {
  readonly element: HTMLSpanElement;
  value: LegendValue;
}

const SEGMENT_SEPARATOR = '  ';
const PRICE_VALUE_CLASS = 'chart-legend-value';
const VOLUME_VALUE_CLASS = 'chart-legend-volume';
const CHANGE_CLASS = 'chart-legend-change';
const OPEN_LABEL = 'O ';
const HIGH_LABEL = 'H ';
const LOW_LABEL = 'L ';
const CLOSE_LABEL = 'C ';
const VOLUME_LABEL = 'Vol ';
const DAY_LABEL = 'Day ';
const BAR_LABEL = 'Bar ';

function labelOf(text: string): LegendLabel {
  return { kind: 'label', text };
}

function valueOf(className: string, text: string, color: string | null): LegendValue {
  return { kind: 'value', className, text, color };
}

/** What a piece of the line is, so two lines are compared without reading the values written into them. */
function segmentSignature(segment: LegendSegment): string {
  return segment.kind === 'label' ? `label:${segment.text}` : `value:${segment.className}`;
}

/** Whether two lines hold the same pieces in the same order, whatever values they show in them. */
function hasSameShape(shown: readonly LegendSegment[], next: readonly LegendSegment[]): boolean {
  if (shown.length !== next.length) {
    return false;
  }
  for (const [index, segment] of next.entries()) {
    const previous = shown[index];
    if (previous === undefined || segmentSignature(previous) !== segmentSignature(segment)) {
      return false;
    }
  }
  return true;
}

/** The value pieces of a line, in draw order. */
function valuesOf(segments: readonly LegendSegment[]): LegendValue[] {
  return segments.filter((segment): segment is LegendValue => segment.kind === 'value');
}

/** Joins the on groups, keeping the two-space gap that separates one readout from the next. */
function joined(groups: readonly (readonly LegendSegment[])[]): LegendSegment[] {
  const segments: LegendSegment[] = [];
  for (const group of groups) {
    if (segments.length > 0) {
      segments.push(labelOf(SEGMENT_SEPARATOR));
    }
    segments.push(...group);
  }
  return segments;
}

/** The four prices as their own spans, so the numbers take the bar's body colour and the labels keep theirs. */
function priceGroups(bar: RenderBar, digits: number, color: string | null): LegendSegment[][] {
  return [
    [labelOf(OPEN_LABEL), valueOf(PRICE_VALUE_CLASS, bar.open.toFixed(digits), color)],
    [labelOf(HIGH_LABEL), valueOf(PRICE_VALUE_CLASS, bar.high.toFixed(digits), color)],
    [labelOf(LOW_LABEL), valueOf(PRICE_VALUE_CLASS, bar.low.toFixed(digits), color)],
    [labelOf(CLOSE_LABEL), valueOf(PRICE_VALUE_CLASS, bar.close.toFixed(digits), color)],
  ];
}

/** Every piece the line draws for `view`, in draw order; a readout that is off is simply absent. */
function segmentsOf(view: OhlcLegendView): LegendSegment[] {
  const { bar } = view;
  if (bar === undefined) {
    return [];
  }
  const groups: LegendSegment[][] = [];
  if (view.title !== null) {
    groups.push([labelOf(view.title)]);
  }
  if (view.chartValues) {
    groups.push(...priceGroups(bar, view.digits, view.valueColor));
  }
  if (view.barChange !== null) {
    groups.push([labelOf(BAR_LABEL), valueOf(CHANGE_CLASS, view.barChange, view.valueColor)]);
  }
  if (view.volume !== null) {
    groups.push([labelOf(VOLUME_LABEL), valueOf(VOLUME_VALUE_CLASS, view.volume, view.valueColor)]);
  }
  if (view.lastDayChange !== null) {
    groups.push([labelOf(DAY_LABEL), valueOf(CHANGE_CLASS, view.lastDayChange.text, view.lastDayChange.color)]);
  }
  return joined(groups);
}

function createValueSpan(value: LegendValue): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = value.className;
  element.textContent = value.text;
  element.style.color = value.color ?? '';
  return element;
}

/** Writes a value onto the span that holds it, leaving the span untouched when it already shows it. */
function writeValue(shown: ShownValue, value: LegendValue): void {
  if (shown.value.text !== value.text) {
    shown.element.textContent = value.text;
  }
  if (shown.value.color !== value.color) {
    shown.element.style.color = value.color ?? '';
  }
  shown.value = value;
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
  private segments: readonly LegendSegment[] = [];
  private values: readonly ShownValue[] = [];

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

  /**
   * Draws `view`. The nodes are rebuilt only when the set of readouts that are on changes, so a move
   * between two bars rewrites their values alone and a move inside one bar touches nothing.
   */
  apply(view: OhlcLegendView): void {
    const segments = segmentsOf(view);
    if (!hasSameShape(this.segments, segments)) {
      this.rebuild(segments);
      return;
    }
    this.writeValues(segments);
  }

  destroy(): void {
    this.element.remove();
  }

  private rebuild(segments: readonly LegendSegment[]): void {
    const nodes: (string | HTMLSpanElement)[] = [];
    const values: ShownValue[] = [];
    for (const segment of segments) {
      if (segment.kind === 'label') {
        nodes.push(segment.text);
        continue;
      }
      const element = createValueSpan(segment);
      values.push({ element, value: segment });
      nodes.push(element);
    }
    this.segments = segments;
    this.values = values;
    this.text.replaceChildren(...nodes);
  }

  /** Writes the values the hovered bar changed, into the very nodes the line already holds. */
  private writeValues(segments: readonly LegendSegment[]): void {
    for (const [index, value] of valuesOf(segments).entries()) {
      const shown = this.values[index];
      if (shown !== undefined) {
        writeValue(shown, value);
      }
    }
    this.segments = segments;
  }
}
