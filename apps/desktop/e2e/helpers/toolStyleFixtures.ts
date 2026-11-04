import type { SettingInputDefinition } from '../../src/features/chart/engine/settings/settingInputs';
import type { SettingStyleDefinition } from '../../src/features/chart/engine/settings/settingStyles';

/** Style definitions shared by the style schema and settings dialog specs: one of every kind, with children. */

export const PROFILE_TOGGLE = {
  kind: 'toggle',
  id: 'profile',
  title: 'Volume profile',
  defaults: { visible: true },
} satisfies SettingStyleDefinition;

export const HISTOGRAM_BOX = {
  kind: 'color',
  id: 'histogramBox',
  title: 'Histogram Box',
  parentId: 'profile',
  defaults: { color: '#2962ff33' },
} satisfies SettingStyleDefinition;

export const POC_LINE = {
  kind: 'line',
  id: 'poc',
  title: 'POC',
  parentId: 'profile',
  defaults: { visible: true, color: '#ff0000', width: 2, style: 'solid' },
} satisfies SettingStyleDefinition;

export const VALUE_AREA_UP = {
  kind: 'color',
  id: 'valueAreaUp',
  title: 'Value Area Up',
  parentId: 'profile',
  defaults: { visible: true, color: '#00ff00' },
} satisfies SettingStyleDefinition;

export const WIDTH_PERCENT = {
  kind: 'number',
  id: 'widthPercent',
  title: 'Width (% of the box)',
  defaultValue: 70,
  minValue: 10,
  maxValue: 100,
  step: 5,
} satisfies SettingStyleDefinition;

export const PLACEMENT = {
  kind: 'choice',
  id: 'placement',
  title: 'Placement',
  defaultValue: 'left',
  options: [
    { value: 'left', title: 'Left' },
    { value: 'right', title: 'Right' },
  ],
} satisfies SettingStyleDefinition;

export const ALL_STYLES: readonly SettingStyleDefinition[] = [
  PROFILE_TOGGLE,
  HISTOGRAM_BOX,
  POC_LINE,
  VALUE_AREA_UP,
  WIDTH_PERCENT,
  PLACEMENT,
];

/** An input whose id collides with the flattened key of the POC line's colour. */
export const COLLIDING_INPUT = {
  kind: 'color',
  id: 'poc.color',
  title: 'Clash',
  defaultValue: '#123456',
} satisfies SettingInputDefinition;
