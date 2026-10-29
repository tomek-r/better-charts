import {
  isToolInputActive,
  isToolInputInvalid,
  isValidToolInputValue,
  resolveToolInputValues,
  type ToolInputDefinition,
  type ToolInputValue,
  type ToolInputValues,
} from './toolInputs';
import { isValidToolStyleValues, resolveToolStyleValues, toolStyleKeys, type ToolStyleDefinition } from './toolStyles';

/** What a tool declares it can be asked for: inputs and styles, both optional. */
export interface ToolSettingsSchema {
  readonly inputs?: readonly ToolInputDefinition[];
  readonly styles?: readonly ToolStyleDefinition[];
}

/**
 * Throws when two settings would store under one key, whether two inputs, two styles, or an input and
 * a flattened style key. Called once when a tool's drawings are defined, so a clash never reaches a save.
 */
export function assertUniqueToolSettingKeys({ inputs = [], styles = [] }: ToolSettingsSchema): void {
  const seen = new Set<string>();
  for (const key of [...inputs.map(({ id }) => id), ...styles.flatMap(toolStyleKeys)]) {
    if (seen.has(key)) {
      throw new Error(`Drawing setting key "${key}" is declared twice.`);
    }
    seen.add(key);
  }
}

/** Whether every active input and every style holds a value its own kind accepts. */
export function areToolSettingValuesValid(
  { inputs = [], styles = [] }: ToolSettingsSchema,
  values: ToolInputValues,
): boolean {
  return (
    inputs.every((definition) => !isToolInputInvalid(definition, values)) &&
    styles.every((definition) => isValidToolStyleValues(definition, values))
  );
}

/**
 * The draft to save: an inactive input whose draft fails its kind takes the value the drawing already held,
 * so nothing invalid is ever stored. `stored` is the resolved settings the form opened with.
 */
export function withStoredValuesForInvalidInactiveInputs(
  { inputs = [] }: ToolSettingsSchema,
  values: ToolInputValues,
  stored: ToolInputValues,
): ToolInputValues {
  const replacements = inputs
    .filter(
      (definition) =>
        !isToolInputActive(definition, values) && !isValidToolInputValue(definition, values[definition.id]),
    )
    .map((definition): [string, ToolInputValue] => [definition.id, stored[definition.id]]);
  return { ...values, ...Object.fromEntries(replacements) };
}

/** The inputs and the flattened styles in one map, each resolved against its own definitions. */
export function resolveToolSettingValues(
  { inputs = [], styles = [] }: ToolSettingsSchema,
  stored: unknown,
): ToolInputValues {
  return { ...resolveToolInputValues(inputs, stored), ...resolveToolStyleValues(styles, stored) };
}
