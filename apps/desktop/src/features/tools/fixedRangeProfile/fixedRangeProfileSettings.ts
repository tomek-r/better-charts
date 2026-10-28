import { DASHED_LINE_PATTERN } from '../../../shared/canvas/dashPatterns';
import type { ProfileRequestParams, ProfileRowsLayout } from '../../bridge/marketDataPort';
import type { ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import { resolveToolSettingValues } from '../../chart/engine/drawings/toolSettings';
import { toolStyleKey } from '../../chart/engine/drawings/toolStyles';
import {
  FIXED_RANGE_PROFILE_INPUTS,
  FIXED_RANGE_PROFILE_STYLES,
  PLACEMENT_RIGHT,
  ROWS_BY_TICKS,
  VALUES_OPPOSITE_SIDE,
  VOLUME_DELTA,
  VOLUME_TOTAL,
  VOLUME_UP_DOWN,
} from './settingsSchema';

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
  /** The fill behind the profile; an alpha of 00 paints no box. */
  readonly histogramBoxColor: string;
  readonly upColor: string;
  readonly downColor: string;
  /** Per-row volume text and the totals line under the profile. */
  readonly valuesVisible: boolean;
  readonly valuesColor: string;
  /** Beside the bars (the edge they hang from) or at the opposite edge of the range box. */
  readonly valuesSide: 'profile' | 'opposite';
  /** Share of the range width (handle to handle) the histogram's widest extent takes, in percent. */
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
  dashed: DASHED_LINE_PATTERN,
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
      histogramBoxColor: textOf(values, toolStyleKey('histogramBox', 'color')),
      upColor: textOf(values, toolStyleKey('upVolume', 'color')),
      downColor: textOf(values, toolStyleKey('downVolume', 'color')),
      valuesVisible: values[toolStyleKey('values', 'visible')] === true,
      valuesColor: textOf(values, toolStyleKey('values', 'color')),
      valuesSide: textOf(values, 'valuesPosition') === VALUES_OPPOSITE_SIDE ? 'opposite' : 'profile',
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

function sameRowsLayout(a: ProfileRowsLayout, b: ProfileRowsLayout): boolean {
  if (a.kind === 'rows') {
    return b.kind === 'rows' && a.count === b.count;
  }
  return b.kind === 'ticksPerRow' && a.ticks === b.ticks;
}

/** Whether two requests ask the backend for the same histogram. */
export function sameProfileRequestParams(a: ProfileRequestParams, b: ProfileRequestParams): boolean {
  return sameRowsLayout(a.rowsLayout, b.rowsLayout) && a.valueAreaPercent === b.valueAreaPercent;
}
