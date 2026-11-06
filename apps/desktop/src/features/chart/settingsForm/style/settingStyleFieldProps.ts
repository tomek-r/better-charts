import type { SettingValue, SettingValues } from '../../engine/settings/settingInputs';
import type { SettingStyleDefinition } from '../../engine/settings/settingStyles';

/** What one style field is given: its definition, every draft value, and whether its row is locked. */
export interface SettingStyleFieldProps<Kind extends SettingStyleDefinition['kind']> {
  readonly definition: Extract<SettingStyleDefinition, { kind: Kind }>;
  readonly values: SettingValues;
  readonly onChange: (key: string, value: SettingValue) => void;
  /** Whether the parent's checkbox, or this row's own, switches the row's controls off. */
  readonly disabled: boolean;
}
