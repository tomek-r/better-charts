import { withOpacityPercent } from '../../../shared/theme/hexColor';
import { palette } from '../../../shared/theme/palette';
import type { ToolInputDefinition } from '../../chart/engine/drawings/toolInputs';
import type { ToolStyleDefinition } from '../../chart/engine/drawings/toolStyles';
import {
  DEFAULT_ROW_COUNT,
  DEFAULT_TICKS_PER_ROW,
  DEFAULT_VALUE_AREA_PERCENT,
  MAX_TICKS_PER_ROW,
} from './requests/profileRequestLimits';

/**
 * What the fixed range volume profile lets the user set. The defaults give mirrored down/up bars from the
 * range start, a solid POC line, dashed VAH and VAL lines to the pane's right edge, one tick per row (the
 * backend coarsens a range that would need too many rows) and a 70% value area. A saved drawing keeps the
 * rows layout it stored, because the collection stores every input resolved.
 */

export const ROWS_BY_COUNT = 'Number Of Rows';
export const ROWS_BY_TICKS = 'Ticks Per Row';
export const VOLUME_UP_DOWN = 'Up/Down';
export const VOLUME_TOTAL = 'Total';
export const VOLUME_DELTA = 'Delta';
export const PLACEMENT_LEFT = 'Left';
export const PLACEMENT_RIGHT = 'Right';
export const VALUES_LEFT_OF_LINE = 'Left';
export const VALUES_CENTERED_ON_LINE = 'Center';
export const VALUES_RIGHT_OF_LINE = 'Right';

/**
 * The Inputs tab. Rows layout, row size and value area feed the request and
 * ask for the profile again; volume and Extend Right only repaint.
 */
export const FIXED_RANGE_PROFILE_INPUTS: readonly ToolInputDefinition[] = [
  {
    kind: 'string',
    id: 'rowsLayout',
    title: 'Rows Layout',
    defaultValue: ROWS_BY_TICKS,
    options: [ROWS_BY_TICKS, ROWS_BY_COUNT],
  },
  {
    kind: 'int',
    id: 'rowCount',
    title: 'Row Size',
    defaultValue: DEFAULT_ROW_COUNT,
    minValue: 1,
    maxValue: 128,
    step: 1,
    activeWhen: { inputId: 'rowsLayout', equals: ROWS_BY_COUNT },
  },
  {
    kind: 'int',
    id: 'ticksPerRow',
    title: 'Ticks Per Row',
    defaultValue: DEFAULT_TICKS_PER_ROW,
    minValue: 1,
    maxValue: MAX_TICKS_PER_ROW,
    step: 1,
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
    defaultValue: DEFAULT_VALUE_AREA_PERCENT,
    minValue: 1,
    maxValue: 100,
    step: 1,
  },
  { kind: 'bool', id: 'extendRight', title: 'Extend Right', defaultValue: true },
];

// Fully transparent, so drawings saved before the boxes existed look unchanged.
const TRANSPARENT_BOX_DEFAULT_COLOR = withOpacityPercent(palette.raised, 0);

/** The settings that only change how the computed profile is painted: changing one repaints. */
export const FIXED_RANGE_PROFILE_STYLES: readonly ToolStyleDefinition[] = [
  { kind: 'color', id: 'upVolume', title: 'Up Volume', defaults: { color: palette.buy } },
  { kind: 'color', id: 'downVolume', title: 'Down Volume', defaults: { color: palette.sell } },
  // Off by default so drawings saved before the labels existed look unchanged.
  { kind: 'color', id: 'values', title: 'Values', defaults: { visible: false, color: palette.text } },
  {
    kind: 'choice',
    id: 'valuesPosition',
    title: 'Values Position',
    defaultValue: VALUES_CENTERED_ON_LINE,
    options: [
      { value: VALUES_LEFT_OF_LINE, title: VALUES_LEFT_OF_LINE },
      { value: VALUES_CENTERED_ON_LINE, title: VALUES_CENTERED_ON_LINE },
      { value: VALUES_RIGHT_OF_LINE, title: VALUES_RIGHT_OF_LINE },
    ],
    parentId: 'values',
  },
  {
    kind: 'color',
    id: 'valuesBackground',
    title: 'Values Background',
    defaults: { color: TRANSPARENT_BOX_DEFAULT_COLOR },
    parentId: 'values',
  },
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
    title: 'Width (% of range)',
    defaultValue: 20,
    minValue: 1,
    maxValue: 100,
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
  // Listed last but painted first, under the bars and level lines. Transparent until the user picks an opacity,
  // so drawings saved before the box existed look unchanged.
  { kind: 'color', id: 'histogramBox', title: 'Histogram Box', defaults: { color: TRANSPARENT_BOX_DEFAULT_COLOR } },
];
