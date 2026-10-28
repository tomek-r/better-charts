import type { ReactNode } from 'react';
import {
  TOOL_INPUT_SOURCES,
  type ToolInputDefinition,
  type ToolInputValue,
} from '../../../chart/engine/drawings/toolInputs';
import { timeframeOptions } from '../../../../shared/bridge/timeframes';
import { Select, type SelectOption } from '../../../../shared/ui/select/Select';

/** What one field is given: its definition, the draft value, and the ids its label needs. */
export interface ToolInputFieldProps<Kind extends ToolInputDefinition['kind']> {
  readonly definition: Extract<ToolInputDefinition, { kind: Kind }>;
  readonly value: ToolInputValue;
  readonly onChange: (value: ToolInputValue) => void;
  /** The control's id, which the field's own label points at. */
  readonly controlId: string;
  /** The id of the tooltip text, when the definition carries one. */
  readonly tooltipId: string | undefined;
  /** Whether the draft value still fails its own kind's rule. */
  readonly invalid: boolean;
  /** Whether the definition's `activeWhen` currently locks the control; its value is kept. */
  readonly disabled: boolean;
}

/**
 * The props of a control that serves several kinds: a union of the per-kind props, which a single kind's
 * own props fit, unlike one props type instantiated with the union of those kinds.
 */
type FieldPropsFor<Kinds extends ToolInputDefinition['kind']> = Kinds extends ToolInputDefinition['kind']
  ? ToolInputFieldProps<Kinds>
  : never;

/** The kinds a drop-down shows: a string with options, plus the three kinds that always list them. */
type ChoiceKind = 'string' | 'enum' | 'source' | 'timeframe';

/** A colour the picker can show while the draft is still invalid. */
const FALLBACK_COLOR = '#000000';
/** Characters of `#RRGGBB`; anything after them is the alpha suffix a colour input cannot show. */
const COLOR_BASE_LENGTH = 7;
/** Characters of the `YYYY-MM-DDTHH:mm` a `datetime-local` input shows. */
const DATETIME_LOCAL_LENGTH = 16;

/** The text a number input shows: empty while the draft holds no number. */
export function numberText(value: ToolInputValue): string {
  return typeof value === 'number' ? String(value) : '';
}

/** The text a text-like control shows: empty while the draft holds no string. */
export function stringText(value: ToolInputValue): string {
  return typeof value === 'string' ? value : '';
}

/** The `datetime-local` text of an instant, in UTC: the input shows wall-clock text, the draft keeps ms. */
function timeText(value: ToolInputValue): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString().slice(0, DATETIME_LOCAL_LENGTH)
    : '';
}

/** The instant a `datetime-local` text names, read in UTC; an empty or impossible text stays invalid (''). */
function epochMilliseconds(text: string): number | '' {
  const parsed = Date.parse(`${text}Z`);
  return text === '' || Number.isNaN(parsed) ? '' : parsed;
}

/** The picker's `#RRGGBB` and the alpha suffix beside it, from a draft the definition already accepts. */
export function colorParts({ value, invalid }: { value: ToolInputValue; invalid: boolean }): {
  base: string;
  alpha: string;
} {
  const colour = stringText(value);
  if (invalid) {
    return { base: FALLBACK_COLOR, alpha: '' };
  }
  return { base: colour.slice(0, COLOR_BASE_LENGTH), alpha: colour.slice(COLOR_BASE_LENGTH) };
}

/** The choices one drop-down lists, named per kind: Pine's own names for sources and timeframes. */
function choiceOptions(definition: Extract<ToolInputDefinition, { kind: ChoiceKind }>): readonly SelectOption[] {
  if (definition.kind === 'enum') {
    return definition.options.map((option) => ({ value: option.value, label: option.title }));
  }
  if (definition.kind === 'source') {
    return TOOL_INPUT_SOURCES.map((source) => ({ value: source, label: source }));
  }
  if (definition.kind === 'timeframe') {
    return timeframeOptions.map((option) => ({ value: option.wire, label: option.label }));
  }
  return (definition.options ?? []).map((option) => ({ value: option, label: option }));
}

/** The attributes every control carries: its label link, its tooltip and its validity. */
function controlAttributes(props: FieldPropsFor<ToolInputDefinition['kind']>) {
  return {
    id: props.controlId,
    title: props.definition.tooltip,
    'aria-describedby': props.tooltipId,
    'aria-invalid': props.invalid,
    disabled: props.disabled,
  };
}

/** A whole number, a decimal, or a display-only price: bounded and stepped as its definition says. */
function NumberControl(props: FieldPropsFor<'int' | 'float' | 'price'>) {
  const bounds = 'minValue' in props.definition ? props.definition : undefined;
  return (
    <input
      {...controlAttributes(props)}
      className="drawing-settings-control"
      type="number"
      min={bounds?.minValue}
      max={bounds?.maxValue}
      step={bounds?.step ?? 'any'}
      value={numberText(props.value)}
      onChange={(event) => props.onChange(event.target.value === '' ? '' : Number(event.target.value))}
    />
  );
}

function BoolControl(props: ToolInputFieldProps<'bool'>) {
  return (
    <input
      {...controlAttributes(props)}
      className="drawing-settings-checkbox"
      type="checkbox"
      checked={props.value === true}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}

function TextControl(props: FieldPropsFor<'string' | 'symbol' | 'session'>) {
  return (
    <input
      {...controlAttributes(props)}
      className="drawing-settings-control"
      type="text"
      autoComplete="off"
      spellCheck={false}
      value={stringText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function TextAreaControl(props: ToolInputFieldProps<'textArea'>) {
  return (
    <textarea
      {...controlAttributes(props)}
      className="drawing-settings-control"
      rows={3}
      value={stringText(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function SelectControl(props: FieldPropsFor<ChoiceKind>) {
  return (
    <Select
      id={props.controlId}
      title={props.definition.tooltip}
      describedBy={props.tooltipId}
      invalid={props.invalid}
      disabled={props.disabled}
      options={choiceOptions(props.definition)}
      value={stringText(props.value)}
      onChange={props.onChange}
    />
  );
}

/** A `string` input lists its options as a drop-down and is a plain text field without any. */
function StringControl(props: ToolInputFieldProps<'string'>) {
  return props.definition.options === undefined ? <TextControl {...props} /> : <SelectControl {...props} />;
}

function ColorControl(props: ToolInputFieldProps<'color'>) {
  const { base, alpha } = colorParts(props);
  return (
    <div className="drawing-settings-color">
      <input
        {...controlAttributes(props)}
        className="drawing-settings-color-input"
        type="color"
        value={base}
        onChange={(event) => props.onChange(`${event.target.value}${alpha}`)}
      />
      <span className="drawing-settings-color-hex">{stringText(props.value)}</span>
    </div>
  );
}

function TimeControl(props: ToolInputFieldProps<'time'>) {
  return (
    <input
      {...controlAttributes(props)}
      className="drawing-settings-control"
      type="datetime-local"
      value={timeText(props.value)}
      onChange={(event) => props.onChange(epochMilliseconds(event.target.value))}
    />
  );
}

/** One field per kind: a new kind is one entry here, and TypeScript refuses a table that misses one. */
export const TOOL_INPUT_FIELDS: {
  readonly [Kind in ToolInputDefinition['kind']]: (props: ToolInputFieldProps<Kind>) => ReactNode;
} = {
  int: NumberControl,
  float: NumberControl,
  price: NumberControl,
  bool: BoolControl,
  string: StringControl,
  textArea: TextAreaControl,
  color: ColorControl,
  source: SelectControl,
  timeframe: SelectControl,
  enum: SelectControl,
  symbol: TextControl,
  session: TextControl,
  time: TimeControl,
};
