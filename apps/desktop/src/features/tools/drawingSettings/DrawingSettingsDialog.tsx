import { useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  isValidToolInputValue,
  type ToolInputDefinition,
  type ToolInputValue,
  type ToolInputValues,
} from '../../chart/engine/drawings/toolInputs';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../shared/ui/ModalDialog';
import { ToolInputField } from './ToolInputField';

/** The inputs sharing one group, or the ungrouped ones; `legend` is undefined for those. */
interface DefinitionGroup {
  readonly legend: string | undefined;
  readonly inputs: readonly ToolInputDefinition[];
}

/** Ungrouped inputs first, then each named group in the order its first input declares it. */
function definitionGroups(definitions: readonly ToolInputDefinition[]): DefinitionGroup[] {
  const ungrouped = definitions.filter((definition) => definition.group === undefined);
  const grouped = new Map<string, ToolInputDefinition[]>();
  for (const definition of definitions) {
    if (definition.group === undefined) {
      continue;
    }
    grouped.set(definition.group, [...(grouped.get(definition.group) ?? []), definition]);
  }
  const named = [...grouped].map(([legend, inputs]) => ({ legend, inputs }));
  return ungrouped.length === 0 ? named : [{ legend: undefined, inputs: ungrouped }, ...named];
}

interface DrawingSettingsGroupProps {
  readonly group: DefinitionGroup;
  readonly values: ToolInputValues;
  readonly onChange: (id: string, value: ToolInputValue) => void;
}

/** One group of fields: a fieldset with its legend, or a plain block while nothing names the group. */
function DrawingSettingsGroup({ group, values, onChange }: DrawingSettingsGroupProps) {
  const fields = group.inputs.map((definition) => (
    <ToolInputField
      key={definition.id}
      definition={definition}
      value={values[definition.id]}
      onChange={(value) => onChange(definition.id, value)}
    />
  ));
  if (group.legend === undefined) {
    return <div className="drawing-settings-group">{fields}</div>;
  }
  return (
    <fieldset className="drawing-settings-group">
      <legend>{group.legend}</legend>
      {fields}
    </fieldset>
  );
}

export interface DrawingSettingsFormProps {
  readonly definitions: readonly ToolInputDefinition[];
  /** The settings the form starts from, read once when the dialog opened. */
  readonly initialValues: ToolInputValues;
  readonly onSave: (values: ToolInputValues) => void;
  readonly onCancel: () => void;
}

/**
 * The settings form itself, apart from the dialog shell so it can be mounted on its own: one field per
 * definition, grouped as the definitions ask, and OK disabled while any value still fails its kind.
 */
export function DrawingSettingsForm({ definitions, initialValues, onSave, onCancel }: DrawingSettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const change = (id: string, value: ToolInputValue) => {
    setValues((current) => ({ ...current, [id]: value }));
  };
  const valid = definitions.every((definition) => isValidToolInputValue(definition, values[definition.id]));
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (valid) {
      onSave(values);
    }
  };
  return (
    <form className="drawing-settings" onSubmit={submit} noValidate>
      {definitions.length === 0 ? <p className="drawing-settings-empty">This tool has no settings yet.</p> : null}
      {definitionGroups(definitions).map((group) => (
        <DrawingSettingsGroup key={group.legend ?? 'ungrouped'} group={group} values={values} onChange={change} />
      ))}
      <div className="modal-dialog-footer">
        <ModalDialogButton variant="secondary" onClick={onCancel}>
          Cancel
        </ModalDialogButton>
        <ModalDialogButton type="submit" disabled={!valid}>
          OK
        </ModalDialogButton>
      </div>
    </form>
  );
}

export interface DrawingSettingsDialogProps {
  /** The tool's name, which titles the dialog: `${label} settings`. */
  readonly label: string;
  readonly definitions: readonly ToolInputDefinition[];
  readonly initialValues: ToolInputValues;
  readonly onSave: (values: ToolInputValues) => void;
  readonly onClose: () => void;
}

/**
 * The settings dialog of one drawing. It is portalled to the page body because the chart frame is a
 * clipped stacking context: the modal has to cover the whole window, the tool rail included.
 */
export function DrawingSettingsDialog({
  label,
  definitions,
  initialValues,
  onSave,
  onClose,
}: DrawingSettingsDialogProps) {
  return createPortal(
    <ModalDialog
      title={`${label} settings`}
      onDismiss={onClose}
      headerActions={<ModalDialogCloseButton label="Close drawing settings" onClick={onClose} />}
    >
      <DrawingSettingsForm definitions={definitions} initialValues={initialValues} onSave={onSave} onCancel={onClose} />
    </ModalDialog>,
    document.body,
  );
}
