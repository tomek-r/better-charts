import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import { LabelledCheckbox } from '../../../settingsForm/LabelledCheckbox';
import { isColorList, type ColorPairNames, type ColorPairValue } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

/** The two names a colour pair's pickers take when the row does not name its own sides. */
const DEFAULT_PAIR_NAMES: ColorPairNames = { up: 'up', down: 'down' };

interface ColorPairPickersProps {
  readonly label: string;
  readonly pair: ColorPairValue;
  readonly names: ColorPairNames;
  readonly onChange: (pair: ColorPairValue) => void;
}

/** The up and down colour of a pair, each named after the field so a picker is never just "up colour". */
function ColorPairPickers({ label, pair, names, onChange }: ColorPairPickersProps) {
  return (
    <div className="chart-settings-colors">
      <ColorPickerButton
        label={`${label} ${names.up} colour`}
        color={pair.up}
        onColorChange={(up) => onChange({ up, down: pair.down })}
      />
      <ColorPickerButton
        label={`${label} ${names.down} colour`}
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
        names={field.colorNames ?? DEFAULT_PAIR_NAMES}
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
      <ColorPairPickers label={field.label} pair={pair} names={DEFAULT_PAIR_NAMES} onChange={onChange} />
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

/**
 * A list of colours one row edits, such as the shades a side's cells are graded through: a picker per entry,
 * each named after the field and its place so no two swatches read alike.
 */
export function ColorListSettingRow({ field, value, onChange }: SettingRowProps<'colorList'>) {
  const colors = isColorList(value) ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <div className="chart-settings-colors">
        {colors.map((color, index) => (
          <ColorPickerButton
            key={`${field.key}-${index}`}
            label={`${field.label} colour ${index + 1}`}
            color={color}
            onColorChange={(edited) => onChange(colors.map((entry, at) => (at === index ? edited : entry)))}
          />
        ))}
      </div>
    </>
  );
}
