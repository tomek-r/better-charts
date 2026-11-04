import { useId, type ReactNode } from 'react';
import type { SettingInputDefinition, SettingValue } from '../../../chart/engine/settings/settingInputs';
import { SETTING_INPUT_FIELDS, type SettingInputFieldProps } from './settingInputFields';

/** The table indexed by one kind is the union of its entries; this names the one call, as the validators do. */
type RenderSettingInputField = (props: SettingInputFieldProps<SettingInputDefinition['kind']>) => ReactNode;

interface SettingInputFieldValues {
  readonly definition: SettingInputDefinition;
  readonly value: SettingValue;
  readonly onChange: (value: SettingValue) => void;
  readonly disabled: boolean;
  /** Whether the draft stops the form from saving; see `isSettingInputInvalid`. */
  readonly invalid: boolean;
}

/**
 * One setting of a drawing: its title as a label, the control its kind asks for, and its tooltip as the
 * control's description. A draft value that blocks saving marks the control invalid.
 */
export function SettingInputField({ definition, value, onChange, disabled, invalid }: SettingInputFieldValues) {
  const controlId = useId();
  const tooltipId = `${controlId}-tooltip`;
  const hasTooltip = definition.tooltip !== undefined;
  const render = SETTING_INPUT_FIELDS[definition.kind] as RenderSettingInputField;
  return (
    <div className="drawing-settings-field">
      <label className="drawing-settings-label" htmlFor={controlId}>
        {definition.title}
      </label>
      {render({
        definition,
        value,
        onChange,
        controlId,
        tooltipId: hasTooltip ? tooltipId : undefined,
        invalid,
        disabled,
      })}
      {hasTooltip ? (
        <span id={tooltipId} className="visually-hidden">
          {definition.tooltip}
        </span>
      ) : null}
    </div>
  );
}
