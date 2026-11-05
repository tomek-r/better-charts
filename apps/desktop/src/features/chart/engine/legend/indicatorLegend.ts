import type { IndicatorLegendValue } from '../indicators/indicatorLayer';

/** One attached indicator's legend line: its words for the settings, then its plot values. */
export interface IndicatorLegendRow {
  readonly instanceId: string;
  readonly title: string;
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
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHEVRON_VIEW_BOX = '0 0 10 10';
const CHEVRON_PATH = 'M2 3.5l3 3 3-3';

function createElementWithClass<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function createChevron(): SVGSVGElement {
  const chevron = document.createElementNS(SVG_NAMESPACE, 'svg');
  chevron.setAttribute('viewBox', CHEVRON_VIEW_BOX);
  chevron.setAttribute('aria-hidden', 'true');
  chevron.setAttribute('class', CHEVRON_CLASS);
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', CHEVRON_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('fill', 'none');
  chevron.append(path);
  return chevron;
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
    this.toggle.append(createChevron(), this.count);
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
    const title = createElementWithClass('span', TITLE_CLASS);
    title.textContent = row.title;
    element.append(title);
    for (const value of row.values) {
      element.append(VALUE_SEPARATOR, this.createValue(value));
    }
    return element;
  }

  private createValue(value: IndicatorLegendValue): HTMLSpanElement {
    const element = createElementWithClass('span', VALUE_CLASS);
    element.textContent = value.value === null ? NO_VALUE_TEXT : value.value.toFixed(this.source.digits());
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
