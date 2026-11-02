import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import type { LineOptions, LineThickness } from '../../../../../shared/ui/colorPicker/LineOptionsSection';
import { LabelledCheckbox } from '../../../../tools/drawingSettings/LabelledCheckbox';
import { LINE_DASH_STYLES, LINE_WIDTHS, type LineValue } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

/** A grid line the chart library draws itself: always one pixel wide, so its picker offers no thickness. */
function lineOptions(line: LineValue, onChange: (line: LineValue) => void): LineOptions {
  return {
    dashStyles: LINE_DASH_STYLES,
    dashStyle: line.style,
    onDashStyleChange: (style) => onChange({ ...line, style }),
  };
}

interface LinePickerProps {
  readonly label: string;
  readonly line: LineValue;
  readonly onChange: (line: LineValue) => void;
  /** The thickness control, for the one canvas line the app draws itself and can draw thicker. */
  readonly thickness?: LineThickness;
}

/** A swatch of the line itself, whose picker edits its colour, dash style and, when it has one, its thickness. */
function LinePicker({ label, line, onChange, thickness }: LinePickerProps) {
  return (
    <ColorPickerButton
      label={label}
      color={line.color}
      onColorChange={(color) => onChange({ ...line, color })}
      line={{ ...lineOptions(line, onChange), thickness }}
    />
  );
}

/** A row of a line the settings show always: the label that names it, beside the picker that edits it. */
function LabelledLinePicker(props: LinePickerProps) {
  return (
    <>
      <span>{props.label}</span>
      <LinePicker {...props} />
    </>
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

export function SizedLineSettingRow({ field, value, onChange }: SettingRowProps<'sizedLine'>) {
  const line = typeof value === 'object' && 'width' in value ? value : field.defaultValue;
  const thickness: LineThickness = {
    width: line.width,
    widths: LINE_WIDTHS,
    onWidthChange: (width) => onChange({ ...line, width }),
  };
  return <LabelledLinePicker label={field.label} line={line} onChange={onChange} thickness={thickness} />;
}
