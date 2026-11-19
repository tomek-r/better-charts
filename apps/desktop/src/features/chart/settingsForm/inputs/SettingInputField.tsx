import type { ReactNode } from 'react';
import type { SettingInputDefinition, SettingValue } from '../../engine/settings/settingInputs';
import { LabelledCheckbox } from '../LabelledCheckbox';
import { SETTING_INPUT_FIELDS, type SettingInputFieldProps as ControlProps } from './settingInputFields';
import { SettingTooltipMark } from './SettingTooltipMark';

/** The table indexed by one kind is the union of its entries; this names the one call, as the validators do. */
type RenderSettingInputField = (props: ControlProps<SettingInputDefinition['kind']>) => ReactNode;

/** What one field of the tab is given: its definition, its control's id and the draft it edits. */
export interface SettingFieldProps {
  readonly definition: SettingInputDefinition;
  /** The control's id, which the field's label points at and its tooltip's id is built from. */
  readonly controlId: string;
  readonly value: SettingValue;
  readonly onChange: (value: SettingValue) => void;
  readonly disabled: boolean;
  /** Whether the draft stops the form from saving; see `isSettingInputInvalid`. */
  readonly invalid: boolean;
}

interface SettingTooltipTextProps {
  readonly tooltip: string | undefined;
  readonly controlId: string;
}

/** The tooltip text a control and its info mark point at, in the page but out of sight. */
function SettingTooltipText({ tooltip, controlId }: SettingTooltipTextProps) {
  if (tooltip === undefined) {
    return null;
  }
  return (
    <span id={`${controlId}-tooltip`} className="visually-hidden">
      {tooltip}
    </span>
  );
}

/** The info mark of one input, for the definitions that carry a tooltip. */
function SettingMark({ definition, controlId }: Pick<SettingFieldProps, 'definition' | 'controlId'>) {
  const { tooltip } = definition;
  if (tooltip === undefined) {
    return null;
  }
  return <SettingTooltipMark text={tooltip} tooltipId={`${controlId}-tooltip`} />;
}

/** One input's control, then its info mark: the whole of the row's control column. */
function SettingControlCell({ definition, controlId, value, onChange, disabled, invalid }: SettingFieldProps) {
  const render = SETTING_INPUT_FIELDS[definition.kind] as RenderSettingInputField;
  return (
    <div className="drawing-settings-control-cell">
      {render({
        definition,
        value,
        onChange,
        controlId,
        tooltipId: definition.tooltip === undefined ? undefined : `${controlId}-tooltip`,
        invalid,
        disabled,
      })}
      <SettingMark definition={definition} controlId={controlId} />
    </div>
  );
}

/** One input's title, the visible label of the row it opens. */
export function SettingInputTitle({ definition, controlId }: SettingFieldProps) {
  if (definition.title === '') {
    return null;
  }
  return (
    <label className="drawing-settings-label" htmlFor={controlId}>
      {definition.title}
    </label>
  );
}

/** The name of an inline row's later control, which the row shows no title for. */
export function SettingQuietTitle({ definition, controlId }: SettingFieldProps) {
  if (definition.title === '') {
    return null;
  }
  return (
    <label className="visually-hidden" htmlFor={controlId}>
      {definition.title}
    </label>
  );
}

/** One input of an inline row: its control and mark, and the tooltip text they describe themselves with. */
export function SettingInlineControl(props: SettingFieldProps) {
  return (
    <>
      <SettingControlCell {...props} />
      <SettingTooltipText tooltip={props.definition.tooltip} controlId={props.controlId} />
    </>
  );
}

/** A bool input: the checkbox first, then the title that names it, then its info mark. */
export function SettingBoolCheckbox({ definition, controlId, value, onChange, disabled }: SettingFieldProps) {
  return (
    <>
      <div className="drawing-settings-bool-row">
        <LabelledCheckbox
          className="drawing-settings-bool"
          checked={value === true}
          disabled={disabled}
          onChange={onChange}
        >
          {definition.title}
        </LabelledCheckbox>
        <SettingMark definition={definition} controlId={controlId} />
      </div>
      <SettingTooltipText tooltip={definition.tooltip} controlId={controlId} />
    </>
  );
}

/** One whole row of the tab: a title beside its control, or the checkbox-first row of a bool. */
export function SettingInputField(props: SettingFieldProps) {
  if (props.definition.kind === 'bool') {
    return <SettingBoolCheckbox {...props} />;
  }
  return (
    <div className="drawing-settings-field">
      <SettingInputTitle {...props} />
      <SettingInlineControl {...props} />
    </div>
  );
}
