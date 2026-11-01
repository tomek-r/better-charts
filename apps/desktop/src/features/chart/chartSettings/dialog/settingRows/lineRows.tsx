import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import type { LineOptions } from '../../../../../shared/ui/colorPicker/LineOptionsSection';
import { LabelledCheckbox } from '../../../../tools/drawingSettings/LabelledCheckbox';
import { LINE_DASH_STYLES, type LineValue } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

/** A line of the canvas is one pixel wide, so the picker offers that width alone and no way to change it. */
const LINE_WIDTH = 1;
const LINE_WIDTHS: readonly number[] = [LINE_WIDTH];

function lineOptions(line: LineValue, onChange: (line: LineValue) => void): LineOptions {
  return {
    widths: LINE_WIDTHS,
    dashStyles: LINE_DASH_STYLES,
    width: LINE_WIDTH,
    dashStyle: line.style,
    // The thickness of a canvas line never changes, so the width the picker offers is the width it draws.
    onWidthChange: () => undefined,
    onDashStyleChange: (style) => onChange({ ...line, style }),
  };
}

interface LinePickerProps {
  readonly label: string;
  readonly line: LineValue;
  readonly onChange: (line: LineValue) => void;
}

/** A swatch of the line itself, whose picker edits its colour and its dash style together. */
function LinePicker({ label, line, onChange }: LinePickerProps) {
  return (
    <ColorPickerButton
      label={label}
      color={line.color}
      onColorChange={(color) => onChange({ ...line, color })}
      line={lineOptions(line, onChange)}
    />
  );
}

export function ToggledLineSettingRow({ field, value, onChange }: SettingRowProps<'toggledLine'>) {
  const line = typeof value === 'object' && 'visible' in value && 'style' in value ? value : field.defaultValue;
  return (
    <>
      <LabelledCheckbox
        className="chart-settings-checkbox-row"
        checked={line.visible}
        onChange={(visible) => onChange({ ...line, visible })}
      >
        {field.label}
      </LabelledCheckbox>
      <LinePicker
        label={`${field.label} colour`}
        line={line}
        onChange={(next) => onChange({ ...next, visible: line.visible })}
      />
    </>
  );
}

export function LineSettingRow({ field, value, onChange }: SettingRowProps<'line'>) {
  const line = typeof value === 'object' && 'style' in value ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <LinePicker label={field.label} line={line} onChange={onChange} />
    </>
  );
}
