import { useId, type ReactNode } from 'react';
import type { ToolInputValue, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import {
  TOOL_STYLE_LINE_STYLES,
  TOOL_STYLE_LINE_WIDTHS,
  toolStyleKey,
  type ToolStyleDefinition,
} from '../../chart/engine/drawings/toolStyles';
import { ColorPickerButton } from '../../../shared/ui/colorPicker/ColorPickerButton';
import type { LineOptions } from '../../../shared/ui/colorPicker/LineOptionsSection';
import { Select } from '../../../shared/ui/Select';
import { VisibleCheckbox } from './styleControls';
import { numberText, stringText } from './toolInputFields';

/** What one style field is given: its definition, every draft value, and whether its row is locked. */
export interface ToolStyleFieldProps<Kind extends ToolStyleDefinition['kind']> {
  readonly definition: Extract<ToolStyleDefinition, { kind: Kind }>;
  readonly values: ToolInputValues;
  readonly onChange: (key: string, value: ToolInputValue) => void;
  /** Whether the parent's checkbox, or this row's own, switches the row's controls off. */
  readonly disabled: boolean;
}

/** The thickness and dash pattern a line's picker edits; an invalid draft reads as a plain thin solid line. */
function lineOptionsOf(
  id: string,
  values: ToolInputValues,
  onChange: (key: string, value: ToolInputValue) => void,
): LineOptions {
  const width = values[toolStyleKey(id, 'width')];
  return {
    widths: TOOL_STYLE_LINE_WIDTHS,
    dashStyles: TOOL_STYLE_LINE_STYLES,
    width: typeof width === 'number' ? width : TOOL_STYLE_LINE_WIDTHS[0],
    dashStyle: TOOL_STYLE_LINE_STYLES.find((style) => style === values[toolStyleKey(id, 'style')]) ?? 'solid',
    onWidthChange: (next) => onChange(toolStyleKey(id, 'width'), next),
    onDashStyleChange: (next) => onChange(toolStyleKey(id, 'style'), next),
  };
}

function LineStyleField({ definition, values, onChange, disabled }: ToolStyleFieldProps<'line'>) {
  const { id, title } = definition;
  const visible = values[toolStyleKey(id, 'visible')] === true;
  return (
    <>
      <VisibleCheckbox
        title={title}
        checked={visible}
        disabled={disabled}
        onChange={(checked) => onChange(toolStyleKey(id, 'visible'), checked)}
      />
      <ColorPickerButton
        label={`${title} colour`}
        color={stringText(values[toolStyleKey(id, 'color')])}
        disabled={disabled || !visible}
        onColorChange={(color) => onChange(toolStyleKey(id, 'color'), color)}
        line={lineOptionsOf(id, values, onChange)}
      />
    </>
  );
}

/** A colour row: with a checkbox when the style can be hidden, a plain title otherwise. */
function ColorStyleField({ definition, values, onChange, disabled }: ToolStyleFieldProps<'color'>) {
  const { id, title } = definition;
  const visibleKey = toolStyleKey(id, 'visible');
  const hasCheckbox = definition.defaults.visible !== undefined;
  const visible = values[visibleKey] === true;
  return (
    <>
      {hasCheckbox ? (
        <VisibleCheckbox
          title={title}
          checked={visible}
          disabled={disabled}
          onChange={(checked) => onChange(visibleKey, checked)}
        />
      ) : (
        <span className="drawing-settings-style-title">{title}</span>
      )}
      <ColorPickerButton
        label={hasCheckbox ? `${title} colour` : title}
        color={stringText(values[toolStyleKey(id, 'color')])}
        disabled={disabled || (hasCheckbox && !visible)}
        onColorChange={(color) => onChange(toolStyleKey(id, 'color'), color)}
      />
    </>
  );
}

function ToggleStyleField({ definition, values, onChange, disabled }: ToolStyleFieldProps<'toggle'>) {
  const visibleKey = toolStyleKey(definition.id, 'visible');
  return (
    <VisibleCheckbox
      title={definition.title}
      checked={values[visibleKey] === true}
      disabled={disabled}
      onChange={(checked) => onChange(visibleKey, checked)}
    />
  );
}

function NumberStyleField({ definition, values, onChange, disabled }: ToolStyleFieldProps<'number'>) {
  const controlId = useId();
  const value = values[definition.id];
  const invalid = typeof value !== 'number' || !Number.isFinite(value);
  return (
    <>
      <label className="drawing-settings-style-title" htmlFor={controlId}>
        {definition.title}
      </label>
      <input
        id={controlId}
        className="drawing-settings-control drawing-settings-style-number"
        type="number"
        min={definition.minValue}
        max={definition.maxValue}
        step={definition.step ?? 'any'}
        value={numberText(value)}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(definition.id, event.target.value === '' ? '' : Number(event.target.value))}
      />
    </>
  );
}

function ChoiceStyleField({ definition, values, onChange, disabled }: ToolStyleFieldProps<'choice'>) {
  const controlId = useId();
  const choiceOptions = definition.options.map((option) => ({ value: option.value, label: option.title }));
  return (
    <>
      <label className="drawing-settings-style-title" htmlFor={controlId}>
        {definition.title}
      </label>
      <Select
        id={controlId}
        options={choiceOptions}
        value={stringText(values[definition.id])}
        disabled={disabled}
        onChange={(value) => onChange(definition.id, value)}
      />
    </>
  );
}

/** One field per style kind: a new kind is one entry here, and TypeScript refuses a table that misses one. */
const TOOL_STYLE_FIELDS: {
  readonly [Kind in ToolStyleDefinition['kind']]: (props: ToolStyleFieldProps<Kind>) => ReactNode;
} = {
  line: LineStyleField,
  color: ColorStyleField,
  toggle: ToggleStyleField,
  number: NumberStyleField,
  choice: ChoiceStyleField,
};

/** The table indexed by one kind is the union of its entries; this names the one call. */
type RenderToolStyleField = (props: ToolStyleFieldProps<ToolStyleDefinition['kind']>) => ReactNode;

/** One row of the Style tab; a child row is marked so the stylesheet indents it under its parent. */
export function ToolStyleField(props: ToolStyleFieldProps<ToolStyleDefinition['kind']>) {
  const render = TOOL_STYLE_FIELDS[props.definition.kind] as RenderToolStyleField;
  return (
    <div className="drawing-settings-style-row" data-child={props.definition.parentId !== undefined}>
      {render(props)}
    </div>
  );
}
