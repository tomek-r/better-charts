import {
  isSettingInputActive,
  isSettingInputInvalid,
  isValidSettingInputValue,
  resolveSettingInputValues,
  type SettingInputDefinition,
  type SettingValue,
  type SettingValues,
} from './settingInputs';
import {
  isValidSettingStyleValues,
  resolveSettingStyleValues,
  settingStyleKeys,
  type SettingStyleDefinition,
} from './settingStyles';

/** What a tool declares it can be asked for: inputs and styles, both optional. */
export interface SettingsSchema {
  readonly inputs?: readonly SettingInputDefinition[];
  readonly styles?: readonly SettingStyleDefinition[];
}

/**
 * Throws when two settings would store under one key, whether two inputs, two styles, or an input and
 * a flattened style key. Called once when a tool's drawings are defined, so a clash never reaches a save.
 */
export function assertUniqueSettingKeys({ inputs = [], styles = [] }: SettingsSchema): void {
  const seen = new Set<string>();
  for (const key of [...inputs.map(({ id }) => id), ...styles.flatMap(settingStyleKeys)]) {
    if (seen.has(key)) {
      throw new Error(`Drawing setting key "${key}" is declared twice.`);
    }
    seen.add(key);
  }
}

/** Whether every active input and every style holds a value its own kind accepts. */
export function areSettingValuesValid({ inputs = [], styles = [] }: SettingsSchema, values: SettingValues): boolean {
  return (
    inputs.every((definition) => !isSettingInputInvalid(definition, values)) &&
    styles.every((definition) => isValidSettingStyleValues(definition, values))
  );
}

/**
 * The draft to save: an inactive input whose draft fails its kind takes the value the drawing already held,
 * so nothing invalid is ever stored. `stored` is the resolved settings the form opened with.
 */
export function withStoredValuesForInvalidInactiveInputs(
  { inputs = [] }: SettingsSchema,
  values: SettingValues,
  stored: SettingValues,
): SettingValues {
  const replacements = inputs
    .filter(
      (definition) =>
        !isSettingInputActive(definition, values) && !isValidSettingInputValue(definition, values[definition.id]),
    )
    .map((definition): [string, SettingValue] => [definition.id, stored[definition.id]]);
  return { ...values, ...Object.fromEntries(replacements) };
}

/** The inputs and the flattened styles in one map, each resolved against its own definitions. */
export function resolveSettingValues({ inputs = [], styles = [] }: SettingsSchema, stored: unknown): SettingValues {
  return { ...resolveSettingInputValues(inputs, stored), ...resolveSettingStyleValues(styles, stored) };
}
