import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ToolInputDefinition, ToolInputValues } from '../../src/features/chart/engine/drawings/toolInputs';
import {
  resolveToolSettingValues,
  type ToolSettingsSchema,
} from '../../src/features/chart/engine/drawings/toolSettings';
import { DrawingSettingsForm } from '../../src/features/tools/drawingSettings/DrawingSettingsDialog';
import { timeframeOptions } from '../../src/shared/bridge/timeframes';

/**
 * Mounts the drawing settings form on its own, with one definition of every Pine-style input kind, and
 * records what its footer hands back. Specs load it by URL as `/e2e/helpers/drawingSettingsHarness.tsx`.
 */

/** One definition of every kind; ids, titles and defaults stay apart from the other input suites. */
export const EVERY_KIND: readonly ToolInputDefinition[] = [
  { kind: 'int', id: 'bars', title: 'Bars', defaultValue: 20, minValue: 1, maxValue: 100, step: 1, group: 'Range' },
  {
    kind: 'float',
    id: 'ratio',
    title: 'Ratio',
    defaultValue: 2.5,
    minValue: 0,
    maxValue: 10,
    step: 0.5,
    group: 'Range',
  },
  { kind: 'price', id: 'level', title: 'Level', defaultValue: 1.5 },
  { kind: 'bool', id: 'filled', title: 'Filled', defaultValue: false },
  {
    kind: 'string',
    id: 'mode',
    title: 'Mode',
    defaultValue: 'volume',
    options: ['volume', 'trades'],
    group: 'Display',
  },
  { kind: 'textArea', id: 'note', title: 'Note', defaultValue: 'opening range' },
  { kind: 'color', id: 'tint', title: 'Tint', defaultValue: '#3366ff' },
  { kind: 'source', id: 'basis', title: 'Basis', defaultValue: 'close' },
  { kind: 'timeframe', id: 'window', title: 'Window', defaultValue: timeframeOptions[0].wire },
  { kind: 'symbol', id: 'target', title: 'Target', defaultValue: 'EURUSD' },
  { kind: 'session', id: 'session', title: 'Session', defaultValue: '0930-1600:23456' },
  { kind: 'time', id: 'since', title: 'Since', defaultValue: 0, tooltip: 'The instant the range starts, in UTC.' },
  {
    kind: 'enum',
    id: 'method',
    title: 'Method',
    defaultValue: 'stepped',
    options: [
      { value: 'stepped', title: 'Stepped' },
      { value: 'smooth', title: 'Smooth' },
    ],
    group: 'Display',
  },
];

/** What the mounted form recorded: every saved draft and every cancel press. */
interface DrawingSettingsRecorder {
  saves: ToolInputValues[];
  cancels: number;
}

/** The padding a modal panel gives its body, so the form's own footer lands where it does in the dialog. */
const PANEL_PADDING = '24px 28px';

/**
 * Mounts the form over an empty page: the app root is hidden so its own labels cannot answer a query.
 * A missing declaration (the specs pass undefined through JSON as null) mounts every input kind;
 * `overrides` replaces the starting draft, e.g. to open a colour with an alpha suffix.
 */
export function mountSettingsFormHarness(
  declared: ToolSettingsSchema | null | undefined,
  overrides: ToolInputValues = {},
): void {
  const settings = declared ?? { inputs: EVERY_KIND };
  const recorderWindow = window as unknown as { __drawingSettings: DrawingSettingsRecorder };
  recorderWindow.__drawingSettings = { saves: [], cancels: 0 };
  const appRoot = document.getElementById('root');
  if (appRoot) {
    appRoot.style.display = 'none';
  }
  const container = document.createElement('div');
  container.style.padding = PANEL_PADDING;
  document.body.append(container);
  act(() => {
    createRoot(container).render(
      createElement(DrawingSettingsForm, {
        settings,
        initialValues: { ...resolveToolSettingValues(settings, undefined), ...overrides },
        onSave: (values) => recorderWindow.__drawingSettings.saves.push(values),
        onCancel: () => {
          recorderWindow.__drawingSettings.cancels += 1;
        },
      }),
    );
  });
}
