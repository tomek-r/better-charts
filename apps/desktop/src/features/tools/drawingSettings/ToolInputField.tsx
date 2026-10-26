import { useId, type ReactNode } from 'react';
import {
  isValidToolInputValue,
  type ToolInputDefinition,
  type ToolInputValue,
} from '../../chart/engine/drawings/toolInputs';
import { TOOL_INPUT_FIELDS, type ToolInputFieldProps } from './toolInputFields';

/** The table indexed by one kind is the union of its entries; this names the one call, as the validators do. */
type RenderToolInputField = (props: ToolInputFieldProps<ToolInputDefinition['kind']>) => ReactNode;

interface ToolInputFieldValues {
  readonly definition: ToolInputDefinition;
  readonly value: ToolInputValue;
  readonly onChange: (value: ToolInputValue) => void;
}

/**
 * One setting of a drawing: its title as a label, the control its kind asks for, and its tooltip as the
 * control's description. A draft value the kind rejects marks the control invalid.
 */
export function ToolInputField({ definition, value, onChange }: ToolInputFieldValues) {
  const controlId = useId();
  const tooltipId = `${controlId}-tooltip`;
  const hasTooltip = definition.tooltip !== undefined;
  const render = TOOL_INPUT_FIELDS[definition.kind] as RenderToolInputField;
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
        invalid: !isValidToolInputValue(definition, value),
      })}
      {hasTooltip ? (
        <span id={tooltipId} className="visually-hidden">
          {definition.tooltip}
        </span>
      ) : null}
    </div>
  );
}
