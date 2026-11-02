import type { ReactNode } from 'react';
import type { ChartSettingField, ChartSettingValue } from '../settingFields';
import { BackgroundFillSettingRow, TextStyleSettingRow } from './settingRows/appearanceRows';
import { CheckboxSettingRow } from './settingRows/checkboxRows';
import { ColorPairSettingRow, ColorSettingRow, ToggledColorPairSettingRow } from './settingRows/colorRows';
import { LineSettingRow, ToggledLineSettingRow } from './settingRows/lineRows';
import { BarCountSettingRow, PercentSettingRow } from './settingRows/numberRows';
import { QuoteLinesSettingRow } from './settingRows/quoteRows';
import { ChoiceSettingRow, LineWidthSettingRow } from './settingRows/selectRows';
import type { SettingRowProps } from './settingRows/settingRowProps';

/** What each kind's row draws: a new kind is one entry here, and TypeScript refuses a table that misses one. */
const SETTING_ROWS: {
  readonly [Kind in ChartSettingField['kind']]: (props: SettingRowProps<Kind>) => ReactNode;
} = {
  checkbox: CheckboxSettingRow,
  toggledColorPair: ToggledColorPairSettingRow,
  colorPair: ColorPairSettingRow,
  color: ColorSettingRow,
  lineWidth: LineWidthSettingRow,
  choice: ChoiceSettingRow,
  percent: PercentSettingRow,
  barCount: BarCountSettingRow,
  toggledLine: ToggledLineSettingRow,
  line: LineSettingRow,
  backgroundFill: BackgroundFillSettingRow,
  quoteLines: QuoteLinesSettingRow,
  textStyle: TextStyleSettingRow,
};

/** The table indexed by one kind is the union of its entries; this names the one call, as the input fields do. */
type RenderSettingRow = (props: SettingRowProps<ChartSettingField['kind']>) => ReactNode;

interface SettingFieldRowProps {
  readonly field: ChartSettingField;
  readonly value: ChartSettingValue;
  readonly onChange: (value: ChartSettingValue) => void;
}

/** A checkbox has no control beside its label, so its row spans the panel and the label stays on one line. */
function rowClassName(kind: ChartSettingField['kind']): string {
  return kind === 'checkbox' ? 'chart-settings-row chart-settings-row-wide' : 'chart-settings-row';
}

/** One row of the settings dialog: the control the field's kind asks for, beside the label that names it. */
export function SettingFieldRow({ field, value, onChange }: SettingFieldRowProps) {
  const render = SETTING_ROWS[field.kind] as RenderSettingRow;
  return <div className={rowClassName(field.kind)}>{render({ field, value, onChange })}</div>;
}
