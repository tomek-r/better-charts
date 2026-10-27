import { palette } from '../../../shared/theme/palette';
import type { ProfileRequestParams, ProfileRowsLayout } from '../../bridge/marketDataPort';
import type { ToolInputDefinition, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import { resolveToolSettingValues } from '../../chart/engine/drawings/toolSettings';
import { toolStyleKey, type ToolStyleDefinition } from '../../chart/engine/drawings/toolStyles';

/**
 * What the fixed range volume profile lets the user set, and the typed reading of the stored values.
 * The defaults reproduce the look and the request this tool had before it had settings, so drawings
 * saved earlier load unchanged: mirrored down/up bars from the range start, a solid POC line, dashed
 * VAH and VAL lines to the pane's right edge, 128 rows and a 70% value area.
 */

const ROWS_BY_COUNT = 'Number Of Rows';
const ROWS_BY_TICKS = 'Ticks Per Row';
const VOLUME_UP_DOWN = 'Up/Down';
const VOLUME_TOTAL = 'Total';
const VOLUME_DELTA = 'Delta';
const PLACEMENT_LEFT = 'Left';
const PLACEMENT_RIGHT = 'Right';

/**
 * The Inputs tab. Rows layout, row size and value area feed the request and
 * ask for the profile again; volume and Extend Right only repaint.
 */
export const FIXED_RANGE_PROFILE_INPUTS: readonly ToolInputDefinition[] = [
  {
    kind: 'string',
    id: 'rowsLayout',
    title: 'Rows Layout',
    defaultValue: ROWS_BY_COUNT,
    options: [ROWS_BY_COUNT, ROWS_BY_TICKS],
    inline: 'rows',
  },
  {
    kind: 'int',
    id: 'rowCount',
    title: 'Row Size',
    defaultValue: 128,
    minValue: 1,
    maxValue: 128,
    step: 1,
    inline: 'rows',
    activeWhen: { inputId: 'rowsLayout', equals: ROWS_BY_COUNT },
  },
  {
    kind: 'int',
    id: 'ticksPerRow',
    title: 'Ticks Per Row',
    defaultValue: 1,
    minValue: 1,
    maxValue: 1000,
    step: 1,
    inline: 'rows',
    activeWhen: { inputId: 'rowsLayout', equals: ROWS_BY_TICKS },
  },
  {
    kind: 'string',
    id: 'volume',
    title: 'Volume',
    defaultValue: VOLUME_UP_DOWN,
    options: [VOLUME_UP_DOWN, VOLUME_TOTAL, VOLUME_DELTA],
  },
  {
    kind: 'int',
    id: 'valueAreaPercent',
    title: 'Value Area Volume %',
    defaultValue: 70,
    minValue: 1,
    maxValue: 100,
    step: 1,
  },
  { kind: 'bool', id: 'extendRight', title: 'Extend Right', defaultValue: true },
];

/** The settings that only change how the computed profile is painted: changing one repaints. */
export const FIXED_RANGE_PROFILE_STYLES: readonly ToolStyleDefinition[] = [
  { kind: 'color', id: 'upVolume', title: 'Up Volume', defaults: { color: palette.buy } },
  { kind: 'color', id: 'downVolume', title: 'Down Volume', defaults: { color: palette.sell } },
  {
    kind: 'line',
    id: 'poc',
    title: 'POC',
    defaults: { visible: true, color: palette.profilePoc, width: 1, style: 'solid' },
  },
  {
    kind: 'line',
    id: 'vah',
    title: 'VAH',
    defaults: { visible: true, color: palette.textBright, width: 1, style: 'dashed' },
  },
  {
    kind: 'line',
    id: 'val',
    title: 'VAL',
    defaults: { visible: true, color: palette.textBright, width: 1, style: 'dashed' },
  },
  {
    kind: 'number',
    id: 'widthPercent',
    title: 'Width (% of pane)',
    defaultValue: 20,
    minValue: 5,
    maxValue: 50,
    step: 1,
  },
  {
    kind: 'choice',
    id: 'placement',
    title: 'Placement',
    defaultValue: PLACEMENT_LEFT,
    options: [
      { value: PLACEMENT_LEFT, title: PLACEMENT_LEFT },
      { value: PLACEMENT_RIGHT, title: PLACEMENT_RIGHT },
    ],
  },
];

/** How each row's volume is drawn: down and up mirrored, stacked into one bar, or their difference. */
export type FixedRangeProfileVolumeMode = 'upDown' | 'total' | 'delta';

/** Which end of the range the bars hang from: the start growing right, or the end growing left. */
export type FixedRangeProfilePlacement = 'left' | 'right';

/** One level line (POC, VAH or VAL) as the user styled it. */
export interface FixedRangeProfileLevelStyle {
  readonly visible: boolean;
  readonly color: string;
  readonly width: number;
  /** The canvas dash pattern; empty for a solid line. */
  readonly dash: readonly number[];
}

/** Everything the renderer reads, resolved from the stored values. */
export interface FixedRangeProfileAppearance {
  readonly volumeMode: FixedRangeProfileVolumeMode;
  readonly placement: FixedRangeProfilePlacement;
  /** Level lines run to the pane's right edge when set, and stop at the range end otherwise. */
  readonly extendRight: boolean;
  readonly upColor: string;
  readonly downColor: string;
  /** Share of the pane width the longest bar may take, in percent. */
  readonly widthPercent: number;
  readonly poc: FixedRangeProfileLevelStyle;
  readonly vah: FixedRangeProfileLevelStyle;
  readonly val: FixedRangeProfileLevelStyle;
}

/** The settings of one drawing, split by what a change to them costs. */
export interface FixedRangeProfileSettings {
  readonly appearance: FixedRangeProfileAppearance;
  readonly requestParams: ProfileRequestParams;
}

const VOLUME_MODE_BY_OPTION: Readonly<Partial<Record<string, FixedRangeProfileVolumeMode>>> = {
  [VOLUME_UP_DOWN]: 'upDown',
  [VOLUME_TOTAL]: 'total',
  [VOLUME_DELTA]: 'delta',
};

/** The dash of each line style: dashed is the owner's 4 on, 3 off; dotted matches the dialog's preview. */
const LINE_DASH_BY_STYLE: Readonly<Partial<Record<string, readonly number[]>>> = {
  solid: [],
  dashed: [4, 3],
  dotted: [1, 3],
};

const SETTINGS_SCHEMA = { inputs: FIXED_RANGE_PROFILE_INPUTS, styles: FIXED_RANGE_PROFILE_STYLES };

// The values are resolved against the schema first, so each key holds its kind's type; the fallbacks
// only narrow the union.
function textOf(values: ToolInputValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value : '';
}

function numberOf(values: ToolInputValues, key: string): number {
  const value = values[key];
  return typeof value === 'number' ? value : Number.NaN;
}

function levelStyleOf(values: ToolInputValues, id: string): FixedRangeProfileLevelStyle {
  return {
    visible: values[toolStyleKey(id, 'visible')] === true,
    color: textOf(values, toolStyleKey(id, 'color')),
    width: numberOf(values, toolStyleKey(id, 'width')),
    dash: LINE_DASH_BY_STYLE[textOf(values, toolStyleKey(id, 'style'))] ?? [],
  };
}

function rowsLayoutOf(values: ToolInputValues): ProfileRowsLayout {
  if (textOf(values, 'rowsLayout') === ROWS_BY_TICKS) {
    return { kind: 'ticksPerRow', ticks: numberOf(values, 'ticksPerRow') };
  }
  return { kind: 'rows', count: numberOf(values, 'rowCount') };
}

/**
 * The typed settings of one drawing. A stored value that is missing or invalid reads as its default,
 * so a drawing saved before any setting existed resolves to the original look and request.
 */
export function readFixedRangeProfileSettings(stored: unknown): FixedRangeProfileSettings {
  const values = resolveToolSettingValues(SETTINGS_SCHEMA, stored);
  return {
    appearance: {
      volumeMode: VOLUME_MODE_BY_OPTION[textOf(values, 'volume')] ?? 'upDown',
      placement: textOf(values, 'placement') === PLACEMENT_RIGHT ? 'right' : 'left',
      extendRight: values.extendRight === true,
      upColor: textOf(values, toolStyleKey('upVolume', 'color')),
      downColor: textOf(values, toolStyleKey('downVolume', 'color')),
      widthPercent: numberOf(values, 'widthPercent'),
      poc: levelStyleOf(values, 'poc'),
      vah: levelStyleOf(values, 'vah'),
      val: levelStyleOf(values, 'val'),
    },
    requestParams: { rowsLayout: rowsLayoutOf(values), valueAreaPercent: numberOf(values, 'valueAreaPercent') },
  };
}

/** What nothing stored resolves to. */
export const DEFAULT_FIXED_RANGE_PROFILE_SETTINGS: FixedRangeProfileSettings = readFixedRangeProfileSettings(undefined);

export const DEFAULT_FIXED_RANGE_PROFILE_APPEARANCE: FixedRangeProfileAppearance =
  DEFAULT_FIXED_RANGE_PROFILE_SETTINGS.appearance;

/** Whether two requests ask the backend for the same histogram. */
export function sameProfileRequestParams(a: ProfileRequestParams, b: ProfileRequestParams): boolean {
  const sameLayout =
    a.rowsLayout.kind === 'rows'
      ? b.rowsLayout.kind === 'rows' && a.rowsLayout.count === b.rowsLayout.count
      : b.rowsLayout.kind === 'ticksPerRow' && a.rowsLayout.ticks === b.rowsLayout.ticks;
  return sameLayout && a.valueAreaPercent === b.valueAreaPercent;
}
