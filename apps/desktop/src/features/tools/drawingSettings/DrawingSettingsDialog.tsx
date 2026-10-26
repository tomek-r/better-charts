import { useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ToolInputValue, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import { areToolSettingValuesValid, type ToolSettingsSchema } from '../../chart/engine/drawings/toolSettings';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../shared/ui/ModalDialog';
import { SettingsTabs } from './SettingsTabs';
import { buildSettingsTabs } from './settingsTabModel';

export interface DrawingSettingsFormProps {
  /** What the tool declares; each part that has content earns a tab. */
  readonly settings: ToolSettingsSchema;
  /** The settings the form starts from, inputs and flattened styles together, read once when the dialog opened. */
  readonly initialValues: ToolInputValues;
  readonly onSave: (values: ToolInputValues) => void;
  readonly onCancel: () => void;
}

/**
 * The settings form itself, apart from the dialog shell so it can be mounted on its own: one tab per part
 * the tool declares, and OK disabled while any value still fails its kind.
 */
export function DrawingSettingsForm({ settings, initialValues, onSave, onCancel }: DrawingSettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const change = (key: string, value: ToolInputValue) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const tabs = buildSettingsTabs(settings);
  const valid = areToolSettingValuesValid(settings, values);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (valid) {
      onSave(values);
    }
  };
  return (
    <form className="drawing-settings" onSubmit={submit} noValidate>
      {tabs.length === 0 ? (
        <p className="drawing-settings-empty">This tool has no settings yet.</p>
      ) : (
        <SettingsTabs tabs={tabs} values={values} onChange={change} />
      )}
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
  readonly settings: ToolSettingsSchema;
  readonly initialValues: ToolInputValues;
  readonly onSave: (values: ToolInputValues) => void;
  readonly onClose: () => void;
}

/**
 * The settings dialog of one drawing. It is portalled to the page body because the chart frame is a
 * clipped stacking context: the modal has to cover the whole window, the tool rail included.
 */
export function DrawingSettingsDialog({ label, settings, initialValues, onSave, onClose }: DrawingSettingsDialogProps) {
  return createPortal(
    <ModalDialog
      title={`${label} settings`}
      onDismiss={onClose}
      headerActions={<ModalDialogCloseButton label="Close drawing settings" onClick={onClose} />}
    >
      <DrawingSettingsForm settings={settings} initialValues={initialValues} onSave={onSave} onCancel={onClose} />
    </ModalDialog>,
    document.body,
  );
}
