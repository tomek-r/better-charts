import type { IndicatorLegendValue } from '../indicators/indicatorLayer';

/** One attached indicator's legend line: its words for the settings, then its plot values. */
export interface IndicatorLegendRow {
  readonly instanceId: string;
  readonly title: string;
  readonly hidden: boolean;
  /** Decimals its values are written with; null writes them with the chart's price precision. */
  readonly digits: number | null;
  readonly values: readonly IndicatorLegendValue[];
}

/** What the legend reads to draw its rows; the chart surface supplies it. */
export interface IndicatorLegendSource {
  /** The rows for the bar with `logicalIndex`, in attach order. */
  rows(logicalIndex: number): readonly IndicatorLegendRow[];
  /** Index of the newest bar, used while no crosshair is on the chart. */
  lastBarIndex(): number;
  /** Price decimals for the plot values. */
  digits(): number;
}

const LEGEND_LABEL = 'Indicator legend';
const COLLAPSE_LABEL = 'Collapse indicator legend';
const EXPAND_LABEL = 'Expand indicator legend';
const NO_VALUE_TEXT = '∅';
const VALUE_SEPARATOR = ' ';
const CONTAINER_CLASS = 'chart-indicator-legend';
const ROWS_CLASS = 'chart-indicator-legend-rows';
const ROW_CLASS = 'chart-indicator-legend-row';
const TITLE_CLASS = 'chart-indicator-legend-title';
const VALUE_CLASS = 'chart-indicator-legend-value';
const TOGGLE_CLASS = 'chart-indicator-legend-toggle';
const COUNT_CLASS = 'chart-indicator-legend-count';
const CHEVRON_CLASS = 'chart-indicator-legend-chevron';
const HIDDEN_ICON_CLASS = 'chart-indicator-legend-hidden-icon';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHEVRON_VIEW_BOX = '0 0 10 10';
const CHEVRON_PATHS = ['M2 3.5l3 3 3-3'];
const HIDDEN_ICON_VIEW_BOX = '0 0 12 12';
const HIDDEN_ICON_PATHS = [
  'M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z',
  'M6 4.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z',
  'M2 10L10 2',
];

function createElementWithClass<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function createIcon(className: string, viewBox: string, paths: readonly string[]): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('viewBox', viewBox);
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('class', className);
  icon.append(...paths.map(createIconPath));
  return icon;
}

function createIconPath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('fill', 'none');
  return path;
}

/** A plot's value written with `decimals` digits; a plot without a value shows the empty marker. */
function formatValue(value: number | null, decimals: number): string {
  return value === null ? NO_VALUE_TEXT : value.toFixed(decimals);
}

/**
 * The indicator rows under the OHLC legend: one line per attached indicator, following the
 * crosshair bar (or the latest bar), with a chevron that collapses them to their count.
 */
export class IndicatorLegend {
  private readonly element: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  private readonly source: IndicatorLegendSource;
  private readonly toggleClicked = (): void => {
    this.collapsed = !this.collapsed;
    this.refresh();
  };

  private collapsed = false;
  private crosshairLogical: number | null = null;

  constructor(host: HTMLElement, source: IndicatorLegendSource) {
    this.source = source;
    this.element = createElementWithClass('div', CONTAINER_CLASS);
    this.element.setAttribute('aria-label', LEGEND_LABEL);
    this.rows = createElementWithClass('div', ROWS_CLASS);
    this.count = createElementWithClass('span', COUNT_CLASS);
    this.toggle = createElementWithClass('button', TOGGLE_CLASS);
    this.toggle.type = 'button';
    this.toggle.append(createIcon(CHEVRON_CLASS, CHEVRON_VIEW_BOX, CHEVRON_PATHS), this.count);
    this.toggle.addEventListener('click', this.toggleClicked);
    this.element.append(this.rows, this.toggle);
    host.append(this.element);
    this.refresh();
  }

  crosshairMoved(logical: number | null): void {
    this.crosshairLogical = logical;
    this.refresh();
  }

  refresh(): void {
    const rows = this.source.rows(this.barIndex());
    this.rows.replaceChildren(...rows.map((row) => this.createRow(row)));
    this.element.hidden = rows.length === 0;
    this.applyToggleState(rows.length);
  }

  destroy(): void {
    this.toggle.removeEventListener('click', this.toggleClicked);
    this.element.remove();
  }

  private barIndex(): number {
    const lastBarIndex = this.source.lastBarIndex();
    if (this.crosshairLogical === null) {
      return lastBarIndex;
    }
    return Math.min(Math.round(this.crosshairLogical), lastBarIndex);
  }

  private createRow(row: IndicatorLegendRow): HTMLDivElement {
    const element = createElementWithClass('div', ROW_CLASS);
    element.dataset.instanceId = row.instanceId;
    if (row.hidden) {
      element.dataset.hidden = 'true';
      element.append(createIcon(HIDDEN_ICON_CLASS, HIDDEN_ICON_VIEW_BOX, HIDDEN_ICON_PATHS));
    }
    const title = createElementWithClass('span', TITLE_CLASS);
    title.textContent = row.title;
    element.append(title);
    for (const value of row.values) {
      element.append(VALUE_SEPARATOR, this.createValue(value, row.digits));
    }
    return element;
  }

  private createValue(value: IndicatorLegendValue, digits: number | null): HTMLSpanElement {
    const element = createElementWithClass('span', VALUE_CLASS);
    element.textContent = formatValue(value.value, digits ?? this.source.digits());
    element.style.color = value.color;
    return element;
  }

  private applyToggleState(rowCount: number): void {
    this.element.dataset.collapsed = String(this.collapsed);
    this.rows.hidden = this.collapsed;
    this.count.hidden = !this.collapsed;
    this.count.textContent = String(rowCount);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    this.toggle.setAttribute('aria-label', this.collapsed ? EXPAND_LABEL : COLLAPSE_LABEL);
  }
}
