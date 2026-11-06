/**
 * The display switches every indicator carries beside its own styles, stored as toggle styles so the engine reads
 * them without knowing any concrete indicator.
 */
import type { SettingValues } from '../settings/settingInputs';
import type { SettingsSchema } from '../settings/settingsSchema';
import { settingStyleKey, type SettingStyleToggle } from '../settings/settingStyles';
import type { ChartIndicatorDefinition } from './indicatorContract';

const LABELS_ON_PRICE_SCALE_ID = 'labelsOnPriceScale';
const VALUES_IN_STATUS_LINE_ID = 'valuesInStatusLine';
const INPUTS_IN_STATUS_LINE_ID = 'inputsInStatusLine';

const OUTPUT_VALUES_SECTION = 'Output values';
const INPUT_VALUES_SECTION = 'Input values';

const SHOWN_BY_DEFAULT = { visible: true } as const;
const HIDDEN_BY_DEFAULT = { visible: false } as const;

/** The `visible` default of a display switch, as its toggle style carries it. */
interface ToggleDefaults {
  readonly visible: boolean;
}

export const INDICATOR_DISPLAY_STYLES: readonly SettingStyleToggle[] = [
  {
    kind: 'toggle',
    id: LABELS_ON_PRICE_SCALE_ID,
    title: 'Labels on price scale',
    section: OUTPUT_VALUES_SECTION,
    defaults: HIDDEN_BY_DEFAULT,
  },
  {
    kind: 'toggle',
    id: VALUES_IN_STATUS_LINE_ID,
    title: 'Values in status line',
    defaults: SHOWN_BY_DEFAULT,
  },
  {
    kind: 'toggle',
    id: INPUTS_IN_STATUS_LINE_ID,
    title: 'Inputs in status line',
    section: INPUT_VALUES_SECTION,
    defaults: SHOWN_BY_DEFAULT,
  },
];

export interface IndicatorDisplay {
  readonly labelsOnPriceScale: boolean;
  readonly valuesInStatusLine: boolean;
  readonly inputsInStatusLine: boolean;
}

export function indicatorSettingsSchema(
  definition: Pick<ChartIndicatorDefinition, 'inputs' | 'styles'>,
): SettingsSchema {
  return {
    inputs: definition.inputs ?? [],
    styles: [...(definition.styles ?? []), ...INDICATOR_DISPLAY_STYLES],
  };
}

export function indicatorDisplayOf(settings: SettingValues): IndicatorDisplay {
  return {
    labelsOnPriceScale: isToggleOn(settings, LABELS_ON_PRICE_SCALE_ID, HIDDEN_BY_DEFAULT),
    valuesInStatusLine: isToggleOn(settings, VALUES_IN_STATUS_LINE_ID, SHOWN_BY_DEFAULT),
    inputsInStatusLine: isToggleOn(settings, INPUTS_IN_STATUS_LINE_ID, SHOWN_BY_DEFAULT),
  };
}

/** The value stored for the display switch `toggleId`, or null when the settings carry none. */
function storedToggle(settings: SettingValues, toggleId: string): boolean | null {
  const value = settings[settingStyleKey(toggleId, 'visible')];
  return typeof value === 'boolean' ? value : null;
}

/** The same settings with the inputs switch off, so a title built from them names no input. */
export function withoutStatusLineInputs(settings: SettingValues): SettingValues {
  return { ...settings, [settingStyleKey(INPUTS_IN_STATUS_LINE_ID, 'visible')]: false };
}

/** Whether the display switch `toggleId` is on: a stored value wins, otherwise the toggle's own default. */
function isToggleOn(settings: SettingValues, toggleId: string, defaults: ToggleDefaults): boolean {
  return storedToggle(settings, toggleId) ?? defaults.visible;
}
