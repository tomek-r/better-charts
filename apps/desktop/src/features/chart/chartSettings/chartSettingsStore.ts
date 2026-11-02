import { invoke } from '@tauri-apps/api/core';
import type { ChartScope } from '../useChartScope';
import { readChartSettingsLayer, type ChartSettingsLayer } from './chartSettings';

/** One chart of the saved layout: its own identity, the group it sits in, and its template. */
interface ChartLayoutEntry {
  readonly chartId: string;
  readonly groupId: string;
  readonly templateId: string;
}

/** What the backend holds for one chart at one account and symbol: its template and its overrides. */
export interface StoredChartSettings {
  readonly templateId: string;
  readonly template: ChartSettingsLayer;
  readonly overrides: ChartSettingsLayer;
}

/**
 * Where each chart's settings live: the template it starts from and the overrides of the account
 * and symbol it shows, kept by the Rust backend in the app data folder. The interface is the whole
 * contract, so a build with another backend answers the same three calls.
 */
export interface ChartSettingsStore {
  /** Every saved chart in layout order, at least one; a layout the backend could not read rejects. */
  loadLayout(): Promise<ChartLayoutEntry[]>;
  /** The template and overrides of one chart for one account and symbol. */
  load(scope: ChartScope): Promise<StoredChartSettings>;
  /** Replaces that chart's overrides; an empty layer removes them, so the chart falls back to its template. */
  saveOverrides(scope: ChartScope, overrides: ChartSettingsLayer): Promise<void>;
}

/** The backend's three commands, named after the trait they answer. */
const LOAD_LAYOUT_COMMAND = 'load_chart_layout';
const LOAD_SETTINGS_COMMAND = 'load_chart_settings';
const SAVE_OVERRIDES_COMMAND = 'save_chart_setting_overrides';

/** Raised when the layout the backend answered is not one this build can draw. */
const UNREADABLE_LAYOUT_MESSAGE = 'The chart layout could not be read';

/** Raised when the backend answered with settings this build cannot read; the file stays untouched. */
const UNREADABLE_SETTINGS_MESSAGE = 'Saved chart settings could not be read';

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isFilledText(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '';
}

/** One layout entry, or undefined for an entry that names no chart, group or template. */
function readLayoutEntry(raw: unknown): ChartLayoutEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { chartId, groupId, templateId } = raw;
  if (!isFilledText(chartId) || !isFilledText(groupId) || !isFilledText(templateId)) {
    return undefined;
  }
  return { chartId, groupId, templateId };
}

/**
 * The whole layout, with every entry checked: the app draws the first chart of it, so a layout
 * this build cannot read is an error rather than one chart of whichever entry survived.
 */
function readLayout(value: unknown): ChartLayoutEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(UNREADABLE_LAYOUT_MESSAGE);
  }
  const layout: ChartLayoutEntry[] = [];
  for (const raw of value) {
    const entry = readLayoutEntry(raw);
    if (entry === undefined) {
      throw new Error(UNREADABLE_LAYOUT_MESSAGE);
    }
    layout.push(entry);
  }
  return layout;
}

/**
 * The answered settings, both layers read by the same reader the model uses. An answer this build
 * cannot read is an error rather than the defaults, which would then be saved over what the user
 * made.
 */
function readStoredSettings(value: unknown): StoredChartSettings {
  if (!isRecord(value) || typeof value.templateId !== 'string') {
    throw new Error(UNREADABLE_SETTINGS_MESSAGE);
  }
  return {
    templateId: value.templateId,
    template: readChartSettingsLayer(value.templateSettings),
    overrides: readChartSettingsLayer(value.overrides),
  };
}

/** The store of the desktop app: the three Rust commands, and nothing else. */
export function createTauriChartSettingsStore(): ChartSettingsStore {
  return {
    loadLayout: async () => readLayout(await invoke(LOAD_LAYOUT_COMMAND)),
    load: async ({ chartId, accountKey, symbol }) => {
      const answered = await invoke(LOAD_SETTINGS_COMMAND, { chartId, accountKey, symbol });
      return readStoredSettings(answered);
    },
    saveOverrides: async ({ chartId, accountKey, symbol }, overrides) => {
      await invoke(SAVE_OVERRIDES_COMMAND, { chartId, accountKey, symbol, overrides });
    },
  };
}
