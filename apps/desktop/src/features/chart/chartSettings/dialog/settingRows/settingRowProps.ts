import type { ChartSettingField, ChartSettingValue } from '../../settingFields';

/** What one row edits: the field it declares, the draft's value, and the way to replace it. */
export interface SettingRowProps<Kind extends ChartSettingField['kind']> {
  readonly field: Extract<ChartSettingField, { kind: Kind }>;
  readonly value: ChartSettingValue;
  readonly onChange: (value: ChartSettingValue) => void;
}
