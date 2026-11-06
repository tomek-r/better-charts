import { useId, type ReactNode } from 'react';
import type { SettingValue, SettingValues } from '../../../chart/engine/settings/settingInputs';
import {
  SETTING_STYLE_LINE_STYLES,
  SETTING_STYLE_LINE_WIDTHS,
  settingStyleKey,
  type SettingStyleDefinition,
} from '../../../chart/engine/settings/settingStyles';
import { ColorPickerButton } from '../../../../shared/ui/colorPicker/ColorPickerButton';
import type { LineOptions } from '../../../../shared/ui/colorPicker/LineOptionsSection';
import { Select } from '../../../../shared/ui/select/Select';
import {
  numberFromInput,
  numberText,
  SETTINGS_SELECT_LIST_CLASS,
  stringText,
  titledOptions,
} from '../inputs/settingInputFields';
import { PlotTypeStyleField } from './PlotTypeStyleField';
import type { SettingStyleFieldProps } from './settingStyleFieldProps';
import { VisibleCheckbox } from './styleControls';

/** The thickness and dash pattern a line's picker edits; an invalid draft reads as a plain thin solid line. */
function lineOptionsOf(
  id: string,
  values: SettingValues,
  onChange: (key: string, value: SettingValue) => void,
): LineOptions {
  const width = values[settingStyleKey(id, 'width')];
  return {
    dashStyles: SETTING_STYLE_LINE_STYLES,
    dashStyle: SETTING_STYLE_LINE_STYLES.find((style) => style === values[settingStyleKey(id, 'style')]) ?? 'solid',
    onDashStyleChange: (next) => onChange(settingStyleKey(id, 'style'), next),
    thickness: {
      widths: SETTING_STYLE_LINE_WIDTHS,
      width: typeof width === 'number' ? width : SETTING_STYLE_LINE_WIDTHS[0],
      onWidthChange: (next) => onChange(settingStyleKey(id, 'width'), next),
    },
  };
}

type StyleFieldEditing = Pick<
  SettingStyleFieldProps<SettingStyleDefinition['kind']>,
  'values' | 'onChange' | 'disabled'
>;

interface ColorRowProps extends StyleFieldEditing {
  readonly id: string;
  readonly title: string;
  /** The thickness and dash pickers of a line; a plain colour has none. */
  readonly line?: LineOptions;
}

/** A style's visible checkbox and its colour picker, which the checkbox switches off. */
function VisibleColorRow({ id, title, values, onChange, disabled, line }: ColorRowProps) {
  const visible = values[settingStyleKey(id, 'visible')] === true;
  return (
    <>
      <VisibleCheckbox
        title={title}
        checked={visible}
        disabled={disabled}
        onChange={(checked) => onChange(settingStyleKey(id, 'visible'), checked)}
      />
      <ColorPickerButton
        label={`${title} colour`}
        color={stringText(values[settingStyleKey(id, 'color')])}
        disabled={disabled || !visible}
        onColorChange={(color) => onChange(settingStyleKey(id, 'color'), color)}
        line={line}
      />
    </>
  );
}

/** A colour that cannot be hidden: the title stands in for the checkbox and names the picker. */
function TitledColorRow({ id, title, values, onChange, disabled }: ColorRowProps) {
  return (
    <>
      <span className="drawing-settings-style-title">{title}</span>
      <ColorPickerButton
        label={title}
        color={stringText(values[settingStyleKey(id, 'color')])}
        disabled={disabled}
        onColorChange={(color) => onChange(settingStyleKey(id, 'color'), color)}
      />
    </>
  );
}

function LineStyleField({ definition, values, onChange, disabled }: SettingStyleFieldProps<'line'>) {
  const { id, title } = definition;
  return (
    <VisibleColorRow
      id={id}
      title={title}
      values={values}
      onChange={onChange}
      disabled={disabled}
      line={lineOptionsOf(id, values, onChange)}
    />
  );
}

/** A colour row: with a checkbox when the style can be hidden, a plain title otherwise. */
function ColorStyleField({ definition, values, onChange, disabled }: SettingStyleFieldProps<'color'>) {
  const { id, title } = definition;
  const Row = definition.defaults.visible === undefined ? TitledColorRow : VisibleColorRow;
  return <Row id={id} title={title} values={values} onChange={onChange} disabled={disabled} />;
}

function ToggleStyleField({ definition, values, onChange, disabled }: SettingStyleFieldProps<'toggle'>) {
  const visibleKey = settingStyleKey(definition.id, 'visible');
  return (
    <VisibleCheckbox
      title={definition.title}
      checked={values[visibleKey] === true}
      disabled={disabled}
      onChange={(checked) => onChange(visibleKey, checked)}
    />
  );
}

function NumberStyleField({ definition, values, onChange, disabled }: SettingStyleFieldProps<'number'>) {
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
        onChange={(event) => onChange(definition.id, numberFromInput(event.target.value))}
      />
    </>
  );
}

function ChoiceStyleField({ definition, values, onChange, disabled }: SettingStyleFieldProps<'choice'>) {
  const controlId = useId();
  return (
    <>
      <label className="drawing-settings-style-title" htmlFor={controlId}>
        {definition.title}
      </label>
      <Select
        id={controlId}
        listClassName={SETTINGS_SELECT_LIST_CLASS}
        options={titledOptions(definition.options)}
        value={stringText(values[definition.id])}
        disabled={disabled}
        onChange={(value) => onChange(definition.id, value)}
      />
    </>
  );
}

/**
 * One field per style kind: a new kind is one entry here, and TypeScript refuses a table that misses one.
 * A field holding state is entered as an element (`(props) => <Field {...props} />`) rather than called as a
 * function: a plain call keeps the field's hooks in this component, where the compiler plugin may reuse the
 * call's output for unchanged props, so the field's own state never reaches the screen.
 */
const SETTING_STYLE_FIELDS: {
  readonly [Kind in SettingStyleDefinition['kind']]: (props: SettingStyleFieldProps<Kind>) => ReactNode;
} = {
  line: LineStyleField,
  color: ColorStyleField,
  toggle: ToggleStyleField,
  number: NumberStyleField,
  choice: ChoiceStyleField,
  plotType: (props) => <PlotTypeStyleField {...props} />,
};

/** The table indexed by one kind is the union of its entries; this names the one call. */
type RenderSettingStyleField = (props: SettingStyleFieldProps<SettingStyleDefinition['kind']>) => ReactNode;

interface SettingStyleRowProps extends SettingStyleFieldProps<SettingStyleDefinition['kind']> {
  /** Drawn last inside the row, for a style that puts a control on another style's row: a Plot type button. */
  readonly trailing?: ReactNode;
}

/** One row of the Style tab; a child row is marked so the stylesheet indents it under its parent. */
export function SettingStyleField({ trailing, ...props }: SettingStyleRowProps) {
  const render = SETTING_STYLE_FIELDS[props.definition.kind] as RenderSettingStyleField;
  return (
    <div className="drawing-settings-style-row" data-child={props.definition.parentId !== undefined}>
      {render(props)}
      {trailing}
    </div>
  );
}
