import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import { LabelledCheckbox } from '../../../../tools/drawingSettings/LabelledCheckbox';
import type { ColorPairValue } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

interface ColorPairPickersProps {
  readonly label: string;
  readonly pair: ColorPairValue;
  readonly onChange: (pair: ColorPairValue) => void;
}

/** The up and down colour of a pair, each named after the field so a picker is never just "up colour". */
function ColorPairPickers({ label, pair, onChange }: ColorPairPickersProps) {
  return (
    <div className="chart-settings-colors">
      <ColorPickerButton
        label={`${label} up colour`}
        color={pair.up}
        onColorChange={(up) => onChange({ up, down: pair.down })}
      />
      <ColorPickerButton
        label={`${label} down colour`}
        color={pair.down}
        onColorChange={(down) => onChange({ up: pair.up, down })}
      />
    </div>
  );
}

export function ToggledColorPairSettingRow({ field, value, onChange }: SettingRowProps<'toggledColorPair'>) {
  const pair = typeof value === 'object' && 'visible' in value && 'up' in value ? value : field.defaultValue;
  return (
    <>
      <LabelledCheckbox
        className="chart-settings-checkbox-row"
        checked={pair.visible}
        onChange={(visible) => onChange({ ...pair, visible })}
      >
        {field.label}
      </LabelledCheckbox>
      <ColorPairPickers
        label={field.label}
        pair={pair}
        onChange={(colors) => onChange({ ...colors, visible: pair.visible })}
      />
    </>
  );
}

export function ToggledColorSettingRow({ field, value, onChange }: SettingRowProps<'toggledColor'>) {
  const toggled = typeof value === 'object' && 'visible' in value && 'color' in value ? value : field.defaultValue;
  return (
    <>
      <LabelledCheckbox
        className="chart-settings-checkbox-row"
        checked={toggled.visible}
        onChange={(visible) => onChange({ ...toggled, visible })}
      >
        {field.label}
      </LabelledCheckbox>
      <ColorPickerButton
        label={`${field.label} colour`}
        color={toggled.color}
        onColorChange={(color) => onChange({ ...toggled, color })}
      />
    </>
  );
}

export function ColorPairSettingRow({ field, value, onChange }: SettingRowProps<'colorPair'>) {
  const pair = typeof value === 'object' && 'up' in value ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <ColorPairPickers label={field.label} pair={pair} onChange={onChange} />
    </>
  );
}

export function ColorSettingRow({ field, value, onChange }: SettingRowProps<'color'>) {
  const color = typeof value === 'string' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <ColorPickerButton label={field.label} color={color} onColorChange={onChange} />
    </>
  );
}
