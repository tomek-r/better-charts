import { createPortal } from 'react-dom';
import type { ChartDrawingPoint } from '../../chart/engine/drawings/drawingRecord';
import type { DrawingTimeframeVisibility } from '../../chart/engine/drawings/timeframeVisibility';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { SettingsForm, type SettingsFormProps } from '../../chart/settingsForm/SettingsForm';
import type { SettingsFormSchema } from '../../chart/settingsForm/settingsTabModel';
import { ModalDialog, ModalDialogCloseButton } from '../../../shared/ui/dialog/ModalDialog';
import { useModalExit } from '../../../shared/ui/dialog/useModalExit';
import { useRevertUnlessSettled } from '../../../shared/ui/dialog/useRevertUnlessSettled';

export interface DrawingSettingsDialogProps {
  /** The tool's name, which titles the dialog: `${label} settings`. */
  readonly label: string;
  readonly settings: SettingsFormSchema;
  readonly initialValues: SettingValues;
  readonly initialPoints: readonly ChartDrawingPoint[];
  readonly initialTimeframeVisibility: DrawingTimeframeVisibility;
  /** Shows the draft on the drawing once the edits rest, without saving it. */
  readonly onPreview: (values: SettingValues) => void;
  /** Puts the stored settings back on the drawing, undoing a preview. */
  readonly onRevert: () => void;
  readonly onSave: SettingsFormProps['onSave'];
  readonly onClose: () => void;
}

/**
 * The settings dialog of one drawing. It is portalled to the page body because the chart frame is a
 * clipped stacking context: the modal has to cover the whole window, the tool rail included. Unlike the
 * other modals it hangs from a fixed offset below the top edge, so switching tabs never moves it.
 *
 * Its Inputs and Style edits show on the drawing as they are made and are saved only on OK; every other
 * way out drops the preview and shows the stored settings.
 */
export function DrawingSettingsDialog({
  label,
  settings,
  initialValues,
  initialPoints,
  initialTimeframeVisibility,
  onPreview,
  onRevert,
  onSave,
  onClose,
}: DrawingSettingsDialogProps) {
  const { backdropRef, closing, close } = useModalExit(onClose);
  const markSettled = useRevertUnlessSettled(onRevert);
  const save: SettingsFormProps['onSave'] = (values, points, timeframeVisibility) => {
    // The tool's answer decides it: a refused anchor keeps the form open, a saved one lets it leave.
    if (!onSave(values, points, timeframeVisibility)) {
      return false;
    }
    markSettled();
    close();
    return true;
  };
  const cancel = () => {
    markSettled();
    onRevert();
    close();
  };
  return createPortal(
    <ModalDialog
      title={`${label} settings`}
      backdropClassName="drawing-settings-backdrop"
      backdropRef={backdropRef}
      closing={closing}
      onDismiss={cancel}
      headerActions={<ModalDialogCloseButton label="Close drawing settings" onClick={cancel} />}
    >
      <SettingsForm
        settings={settings}
        initialValues={initialValues}
        initialPoints={initialPoints}
        initialTimeframeVisibility={initialTimeframeVisibility}
        // A draft still resting must not reach the chart once the dialog is leaving: OK kept it, Cancel reverted.
        onPreview={closing ? undefined : onPreview}
        onSave={save}
        onCancel={cancel}
      />
    </ModalDialog>,
    document.body,
  );
}
