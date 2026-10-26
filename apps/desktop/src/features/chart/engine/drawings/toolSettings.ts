import {
  isValidToolInputValue,
  resolveToolInputValues,
  type ToolInputDefinition,
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

/** Whether every input and every style holds a value its own kind accepts. */
export function areToolSettingValuesValid(
  { inputs = [], styles = [] }: ToolSettingsSchema,
  values: ToolInputValues,
): boolean {
  return (
    inputs.every((definition) => isValidToolInputValue(definition, values[definition.id])) &&
    styles.every((definition) => isValidToolStyleValues(definition, values))
  );
}

/** The inputs and the flattened styles in one map, each resolved against its own definitions. */
export function resolveToolSettingValues(
  { inputs = [], styles = [] }: ToolSettingsSchema,
  stored: unknown,
): ToolInputValues {
  return { ...resolveToolInputValues(inputs, stored), ...resolveToolStyleValues(styles, stored) };
}
