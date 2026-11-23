import { OBJECT_SETTINGS_ICON_PATHS } from '../../../../shared/ui/icons/objectSettingsIcon';
import type { IndicatorLegendValue, IndicatorPaneHeight } from '../indicators/indicatorLayer';
import {
  INDICATOR_MORE_ACTIONS_LABEL,
  INDICATOR_SETTINGS_LABEL,
  INDICATOR_VISIBILITY_LABELS,
  REMOVE_INDICATOR_LABEL,
} from './indicatorLegendLabels';

/**
 * The words naming an attached indicator: the plugin's short title, then the inputs it names after it,
 * e.g. "SMA" and "9 close 1H". The two runs are written in different colours, so they are kept apart.
 */
export interface IndicatorLegendWords {
  readonly shortTitle: string;
  readonly inputs: string;
}

/** One attached indicator's legend line: its words for the settings, then its plot values. */
export interface IndicatorLegendRow {
  readonly instanceId: string;
  readonly words: IndicatorLegendWords;
  readonly hidden: boolean;
  /** Whether the user selected this indicator, which keeps its row framed and its buttons in sight. */
  readonly selected: boolean;
  /** Decimals its values are written with; null writes them with the chart's price precision. */
  readonly digits: number | null;
  readonly values: readonly IndicatorLegendValue[];
  /** The element of the indicator's own pane its row sits in; null puts it under the OHLC line. */
  readonly paneHost: HTMLElement | null;
}

/** What the row buttons ask the app to do; the app saves and the chart follows. */
export interface IndicatorLegendCommands {
  openSettings(instanceId: string): void;
  setHidden(instanceId: string, hidden: boolean): void;
  remove(instanceId: string): void;
  /**
   * Opens the indicator's actions menu under the row `anchor` button, which gives the menu its place and takes
   * the focus back as the menu closes.
   */
  openActionsMenu(instanceId: string, anchor: HTMLElement): void;
  /**
   * Saves the pane heights the user dragged the separators to, each relative to the price pane; the app
   * stores them with the indicators they belong to, so a chart opened again restores them.
   */
  setPaneHeights(heights: readonly IndicatorPaneHeight[]): void;
  /** Saves whether the rows are collapsed to their count, so a chart opened again draws them so. */
  setLegendCollapsed(collapsed: boolean): void;
}

/** What the legend reads to draw its rows; the chart surface supplies it. */
export interface IndicatorLegendSource {
  /** The rows for the bar at `barIndex`, in attach order. */
  rows(barIndex: number): readonly IndicatorLegendRow[];
  /** The index of the bar the pointer is over, the last bar while no bar has its time, and -1 with no bars. */
  hoveredIndex(): number;
  /** Price decimals for the plot values. */
  digits(): number;
}

/** One row's elements; they outlive a refresh, so hover and focus survive a crosshair move. */
interface RowView {
  readonly element: HTMLDivElement;
  readonly title: HTMLSpanElement;
  readonly inputs: HTMLSpanElement;
  readonly visibilityIcon: SVGSVGElement;
  readonly visibility: HTMLButtonElement;
  readonly values: HTMLSpanElement;
  hidden: boolean;
}

/** A source row and the view drawing it. */
interface RowEntry {
  readonly row: IndicatorLegendRow;
  readonly view: RowView;
}

const LEGEND_LABEL = 'Indicator legend';
const COLLAPSE_LABEL = 'Collapse indicator legend';
const EXPAND_LABEL = 'Expand indicator legend';
const NO_VALUE_TEXT = '∅';
const WORD_SEPARATOR = ' ';
const CONTAINER_CLASS = 'chart-indicator-legend';
const ROWS_CLASS = 'chart-indicator-legend-rows';
const ROW_CLASS = 'chart-indicator-legend-row';
const TITLE_CLASS = 'chart-indicator-legend-title';
const INPUTS_CLASS = 'chart-indicator-legend-inputs';
const VALUE_CLASS = 'chart-indicator-legend-value';
const VALUES_CLASS = 'chart-indicator-legend-values';
const ACTIONS_CLASS = 'chart-indicator-legend-actions';
const ACTION_CLASS = 'chart-indicator-legend-action';
const ACTION_ICON_CLASS = 'chart-indicator-legend-action-icon';
const GEAR_ICON_CLASS = `${ACTION_ICON_CLASS} chart-indicator-legend-gear-icon`;
const TOGGLE_CLASS = 'chart-indicator-legend-toggle';
const COUNT_CLASS = 'chart-indicator-legend-count';
const CHEVRON_CLASS = 'chart-indicator-legend-chevron';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHEVRON_VIEW_BOX = '0 0 10 10';
const CHEVRON_PATHS = ['M2 3.5l3 3 3-3'];
const ICON_VIEW_BOX = '0 0 12 12';
const EYE_PATHS = ['M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z', 'M6 4.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z'];
const EYE_OFF_PATHS = [...EYE_PATHS, 'M2 10L10 2'];
/**
 * The settings icon the drawing toolbar and the Object tree use, drawn in the 24-unit square the outline
 * icons use.
 */
const GEAR_VIEW_BOX = '0 0 24 24';
const GEAR_PATHS = OBJECT_SETTINGS_ICON_PATHS;
const TRASH_PATHS = ['M2 3h8', 'M4.5 3V2h3v1', 'M3 3l.5 7.5h5L9 3', 'M5 5v4M7 5v4'];
/** The three dots of the More button, which are filled rather than stroked like the row's other icons. */
const MORE_DOT_XS = [3, 6, 9];
const MORE_DOT_Y = 6;
const MORE_DOT_RADIUS = 1;

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

function createMoreDot(x: number): SVGCircleElement {
  const dot = document.createElementNS(SVG_NAMESPACE, 'circle');
  dot.setAttribute('cx', String(x));
  dot.setAttribute('cy', String(MORE_DOT_Y));
  dot.setAttribute('r', String(MORE_DOT_RADIUS));
  dot.setAttribute('fill', 'currentColor');
  return dot;
}

/** The More icon: the row's icon box holding three filled dots. */
function createMoreIcon(): SVGSVGElement {
  const icon = createIcon(ACTION_ICON_CLASS, ICON_VIEW_BOX, []);
  icon.append(...MORE_DOT_XS.map(createMoreDot));
  return icon;
}

/** A row button: an icon whose label is spoken and shown on hover, which the button hands to the command. */
function createActionButton(
  label: string,
  icon: SVGSVGElement,
  clicked: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ACTION_CLASS;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon);
  button.addEventListener('click', () => clicked(button));
  return button;
}

/** A plot's value written with `decimals` digits; a plot without a value shows the empty marker. */
function formatValue(value: number | null, decimals: number): string {
  return value === null ? NO_VALUE_TEXT : value.toFixed(decimals);
}

function createValueElement(value: IndicatorLegendValue, decimals: number): HTMLSpanElement {
  const element = createElementWithClass('span', VALUE_CLASS);
  element.textContent = formatValue(value.value, decimals);
  element.style.color = value.color;
  return element;
}

/** The inputs as the row writes them after the title: the word between the two runs stays in the text. */
function inputsTextOf(inputs: string): string {
  return inputs === '' ? '' : `${WORD_SEPARATOR}${inputs}`;
}

function hasSameChildren(parent: HTMLElement, wanted: readonly HTMLDivElement[]): boolean {
  if (parent.children.length !== wanted.length) {
    return false;
  }
  return wanted.every((child, index) => parent.children[index] === child);
}

function placeInHost(element: HTMLDivElement, host: HTMLElement): void {
  if (element.parentElement !== host) {
    host.append(element);
  }
}

/** Marks the row with a bare attribute the stylesheet selects on, and drops the attribute when it is off. */
function applyRowFlag(element: HTMLDivElement, name: 'hidden' | 'selected', on: boolean): void {
  if (on) {
    element.dataset[name] = 'true';
    return;
  }
  delete element.dataset[name];
}

/**
 * The indicator rows of the legend: one line per attached indicator, following the crosshair bar
 * (or the latest bar), each with buttons that hide it, open its settings or remove it, and a
 * chevron that collapses the price-pane rows to their count. An indicator holding a pane of its own
 * shows its row at the top-left of that pane instead.
 */
export class IndicatorLegend {
  private readonly element: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  private readonly source: IndicatorLegendSource;
  private readonly commands: IndicatorLegendCommands;
  private readonly views = new Map<string, RowView>();
  private readonly toggleClicked = (): void => {
    const next = !this.collapsed;
    this.setCollapsed(next);
    this.commands.setLegendCollapsed(next);
  };

  private collapsed = false;

  constructor(host: HTMLElement, source: IndicatorLegendSource, commands: IndicatorLegendCommands) {
    this.source = source;
    this.commands = commands;
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

  refresh(): void {
    const entries = this.source.rows(this.source.hoveredIndex()).map((row) => this.entryOf(row));
    for (const { row, view } of entries) {
      this.applyRow(view, row);
    }
    this.dropUnusedViews(entries);
    const pricePaneEntries = entries.filter(({ row }) => row.paneHost === null);
    this.placePricePaneRows(pricePaneEntries);
    for (const { row, view } of entries) {
      if (row.paneHost !== null) {
        placeInHost(view.element, row.paneHost);
      }
    }
    this.element.hidden = pricePaneEntries.length === 0;
    this.applyToggleState(pricePaneEntries.length);
  }

  /** Shows the rows collapsed to their count or expanded, redrawing only when the state changed. */
  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) {
      return;
    }
    this.collapsed = collapsed;
    this.refresh();
  }

  destroy(): void {
    this.toggle.removeEventListener('click', this.toggleClicked);
    for (const view of this.views.values()) {
      view.element.remove();
    }
    this.views.clear();
    this.element.remove();
  }

  /** The view drawing `row`, made the first time the indicator shows a row. */
  private entryOf(row: IndicatorLegendRow): RowEntry {
    const existing = this.views.get(row.instanceId);
    if (existing !== undefined) {
      return { row, view: existing };
    }
    const view = this.createRow(row.instanceId);
    this.views.set(row.instanceId, view);
    return { row, view };
  }

  private createRow(instanceId: string): RowView {
    const element = createElementWithClass('div', ROW_CLASS);
    element.dataset.instanceId = instanceId;
    const openSettings = (): void => this.commands.openSettings(instanceId);
    const title = createElementWithClass('span', TITLE_CLASS);
    title.addEventListener('dblclick', openSettings);
    const inputs = createElementWithClass('span', INPUTS_CLASS);
    inputs.addEventListener('dblclick', openSettings);
    const visibilityIcon = createIcon(ACTION_ICON_CLASS, ICON_VIEW_BOX, EYE_PATHS);
    const visibility = createActionButton(INDICATOR_VISIBILITY_LABELS.off, visibilityIcon, () => {
      const view = this.views.get(instanceId);
      if (view !== undefined) {
        this.commands.setHidden(instanceId, !view.hidden);
      }
    });
    const settings = createActionButton(
      INDICATOR_SETTINGS_LABEL,
      createIcon(GEAR_ICON_CLASS, GEAR_VIEW_BOX, GEAR_PATHS),
      openSettings,
    );
    const remove = createActionButton(
      REMOVE_INDICATOR_LABEL,
      createIcon(ACTION_ICON_CLASS, ICON_VIEW_BOX, TRASH_PATHS),
      () => this.commands.remove(instanceId),
    );
    const more = createActionButton(INDICATOR_MORE_ACTIONS_LABEL, createMoreIcon(), (button) =>
      this.commands.openActionsMenu(instanceId, button),
    );
    more.setAttribute('aria-haspopup', 'menu');
    // The menu marks the button expanded while it is open, which keeps the row's buttons in sight.
    more.setAttribute('aria-expanded', 'false');
    const actions = createElementWithClass('span', ACTIONS_CLASS);
    actions.append(visibility, settings, remove, more);
    const values = createElementWithClass('span', VALUES_CLASS);
    element.append(title, inputs, actions, values);
    return { element, title, inputs, visibilityIcon, visibility, values, hidden: false };
  }

  private applyRow(view: RowView, row: IndicatorLegendRow): void {
    view.hidden = row.hidden;
    view.title.textContent = row.words.shortTitle;
    this.applyInputs(view, row.words.inputs);
    applyRowFlag(view.element, 'hidden', row.hidden);
    applyRowFlag(view.element, 'selected', row.selected);
    this.applyVisibilityButton(view);
    this.applyValues(view, row);
  }

  /** Writes the inputs after the title; an indicator that names none leaves the run out of the row. */
  private applyInputs(view: RowView, inputs: string): void {
    const text = inputsTextOf(inputs);
    view.inputs.textContent = text;
    view.inputs.hidden = text === '';
  }

  private applyVisibilityButton(view: RowView): void {
    const label = view.hidden ? INDICATOR_VISIBILITY_LABELS.on : INDICATOR_VISIBILITY_LABELS.off;
    const paths = view.hidden ? EYE_OFF_PATHS : EYE_PATHS;
    view.visibilityIcon.replaceChildren(...paths.map(createIconPath));
    view.visibility.setAttribute('aria-label', label);
    view.visibility.title = label;
    view.visibility.setAttribute('aria-pressed', String(view.hidden));
  }

  private applyValues(view: RowView, row: IndicatorLegendRow): void {
    if (row.values.length === 0) {
      // An indicator whose status line shows no values keeps only its words, with no separator left over.
      view.values.replaceChildren();
      return;
    }
    const decimals = row.digits ?? this.source.digits();
    view.values.replaceChildren(WORD_SEPARATOR, ...row.values.map((value) => createValueElement(value, decimals)));
  }

  /** Forgets the views of the indicators whose row is gone, and takes their element off the chart. */
  private dropUnusedViews(entries: readonly RowEntry[]): void {
    const keptIds = new Set(entries.map(({ row }) => row.instanceId));
    for (const [instanceId, view] of [...this.views]) {
      if (keptIds.has(instanceId)) {
        continue;
      }
      view.element.remove();
      this.views.delete(instanceId);
    }
  }

  /** Puts the price-pane rows in attach order, touching the DOM only when that order differs. */
  private placePricePaneRows(entries: readonly RowEntry[]): void {
    const wanted = entries.map(({ view }) => view.element);
    if (!hasSameChildren(this.rows, wanted)) {
      this.rows.replaceChildren(...wanted);
    }
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
