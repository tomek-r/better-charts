import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import { Select, type SelectOption } from '../../../../../shared/ui/select/Select';
import {
  BACKGROUND_FILL_MODES,
  TEXT_FONT_SIZES,
  type BackgroundFillMode,
  type BackgroundFillValue,
} from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

const FILL_MODE_LABELS: Readonly<Record<BackgroundFillMode, string>> = { solid: 'Solid', gradient: 'Gradient' };

const FILL_MODE_OPTIONS: readonly SelectOption[] = BACKGROUND_FILL_MODES.map((mode) => ({
  value: mode,
  label: FILL_MODE_LABELS[mode],
}));

const FONT_SIZE_OPTIONS: readonly SelectOption[] = TEXT_FONT_SIZES.map((size) => ({
  value: String(size),
  label: String(size),
}));

/** The mode an option names; the select only ever names one of the two the field holds. */
function fillModeOf(choice: string): BackgroundFillMode {
  return choice === 'gradient' ? 'gradient' : 'solid';
}

interface BackgroundSwatchesProps {
  readonly label: string;
  readonly fill: BackgroundFillValue;
  readonly onChange: (fill: BackgroundFillValue) => void;
}

/** One swatch for a solid fill, the top and the bottom one for a gradient. */
function BackgroundSwatches({ label, fill, onChange }: BackgroundSwatchesProps) {
  if (fill.mode === 'gradient') {
    return (
      <>
        <ColorPickerButton
          label={`${label} top colour`}
          color={fill.color}
          onColorChange={(color) => onChange({ ...fill, color })}
        />
        <ColorPickerButton
          label={`${label} bottom colour`}
          color={fill.bottomColor}
          onColorChange={(bottomColor) => onChange({ ...fill, bottomColor })}
        />
      </>
    );
  }
  return (
    <ColorPickerButton
      label={`${label} colour`}
      color={fill.color}
      onColorChange={(color) => onChange({ ...fill, color })}
    />
  );
}

export function BackgroundFillSettingRow({ field, value, onChange }: SettingRowProps<'backgroundFill'>) {
  const fill = typeof value === 'object' && 'mode' in value ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <div className="chart-settings-controls">
        <Select
          ariaLabel={`${field.label} fill`}
          options={FILL_MODE_OPTIONS}
          value={fill.mode}
          onChange={(choice) => onChange({ ...fill, mode: fillModeOf(choice) })}
        />
        <BackgroundSwatches label={field.label} fill={fill} onChange={onChange} />
      </div>
    </>
  );
}

export function TextStyleSettingRow({ field, value, onChange }: SettingRowProps<'textStyle'>) {
  const text = typeof value === 'object' && 'fontSize' in value ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <div className="chart-settings-controls">
        <ColorPickerButton
          label={`${field.label} colour`}
          color={text.color}
          onColorChange={(color) => onChange({ ...text, color })}
        />
        <Select
          ariaLabel={`${field.label} font size`}
          options={FONT_SIZE_OPTIONS}
          value={String(text.fontSize)}
          onChange={(size) => onChange({ ...text, fontSize: Number(size) })}
        />
      </div>
    </>
  );
}
