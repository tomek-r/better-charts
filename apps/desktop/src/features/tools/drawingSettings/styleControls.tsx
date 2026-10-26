import { isColorText, type ToolInputValue } from '../../chart/engine/drawings/toolInputs';
import {
  TOOL_STYLE_LINE_STYLES,
  TOOL_STYLE_LINE_WIDTHS,
  type ToolStyleLineStyle,
} from '../../chart/engine/drawings/toolStyles';
import { colorParts, numberText, stringText } from './toolInputFields';

/** SVG dash pattern of each line style in the preview, in px; a solid line has none. */
const PREVIEW_DASH: Readonly<Record<ToolStyleLineStyle, string | undefined>> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1 3',
};
const PREVIEW_WIDTH_PX = 36;
const PREVIEW_HEIGHT_PX = 12;
const PREVIEW_MARGIN_PX = 2;

interface VisibleCheckboxProps {
  readonly title: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** The visible checkbox of a style row, labelled by the style's title. */
export function VisibleCheckbox({ title, checked, disabled, onChange }: VisibleCheckboxProps) {
  return (
    <label className="drawing-settings-style-title">
      <input
        className="drawing-settings-checkbox"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{title}</span>
    </label>
  );
}

interface ColorSwatchProps {
  readonly label: string;
  readonly value: ToolInputValue;
  readonly disabled: boolean;
  readonly onChange: (color: string) => void;
}

/** A colour swatch: the native picker, keeping the alpha suffix a stored colour carries. */
export function ColorSwatch({ label, value, disabled, onChange }: ColorSwatchProps) {
  const invalid = !isColorText(value);
  const { base, alpha } = colorParts({ value, invalid });
  return (
    <input
      className="drawing-settings-color-input"
      type="color"
      aria-label={label}
      aria-invalid={invalid}
      value={base}
      disabled={disabled}
      onChange={(event) => onChange(`${event.target.value}${alpha}`)}
    />
  );
}

interface LinePreviewProps {
  readonly color: ToolInputValue;
  readonly width: ToolInputValue;
  readonly style: ToolInputValue;
}

/** A short sample of the line the style paints; an invalid draft falls back to a plain 1px line. */
function LinePreview({ color, width, style }: LinePreviewProps) {
  const middle = PREVIEW_HEIGHT_PX / 2;
  return (
    <svg
      className="drawing-settings-line-preview"
      width={PREVIEW_WIDTH_PX}
      height={PREVIEW_HEIGHT_PX}
      aria-hidden="true"
    >
      <line
        x1={PREVIEW_MARGIN_PX}
        x2={PREVIEW_WIDTH_PX - PREVIEW_MARGIN_PX}
        y1={middle}
        y2={middle}
        stroke={isColorText(color) ? color : 'currentColor'}
        strokeWidth={typeof width === 'number' ? width : 1}
        strokeDasharray={PREVIEW_DASH[style as ToolStyleLineStyle]}
      />
    </svg>
  );
}

interface LinePickerProps extends LinePreviewProps {
  readonly title: string;
  readonly disabled: boolean;
  readonly onWidthChange: (width: number) => void;
  readonly onStyleChange: (style: string) => void;
}

/** The line preview as a button that opens width and dash drop-downs; a disabled picker is inert. */
export function LinePicker({ title, color, width, style, disabled, onWidthChange, onStyleChange }: LinePickerProps) {
  return (
    <details className="drawing-settings-line-picker" inert={disabled}>
      <summary aria-label={`${title} line style`}>
        <LinePreview color={color} width={width} style={style} />
      </summary>
      <div className="drawing-settings-line-popover">
        <select
          className="drawing-settings-control"
          aria-label={`${title} width`}
          value={numberText(width)}
          onChange={(event) => onWidthChange(Number(event.target.value))}
        >
          {TOOL_STYLE_LINE_WIDTHS.map((option) => (
            <option key={option} value={option}>
              {`${option}px`}
            </option>
          ))}
        </select>
        <select
          className="drawing-settings-control"
          aria-label={`${title} dash`}
          value={stringText(style)}
          onChange={(event) => onStyleChange(event.target.value)}
        >
          {TOOL_STYLE_LINE_STYLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </details>
  );
}
