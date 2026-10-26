import { useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ChartDrawingPoint } from '../../chart/engine/drawings/drawingRecord';
import type { ToolInputValue, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../../chart/engine/drawings/timeframeVisibility';
import { areToolSettingValuesValid } from '../../chart/engine/drawings/toolSettings';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../shared/ui/ModalDialog';
import { SettingsTabs } from './SettingsTabs';
import { buildSettingsTabs, COORDINATES_TAB_ID, type DrawingSettingsSchema } from './settingsTabModel';
import { useCoordinateDraft } from './useCoordinateDraft';
import { useTimeframeVisibilityDraft } from './useTimeframeVisibilityDraft';

/** The no-anchor default, one list so a form without anchors keeps a stable prop. */
const NO_POINTS: readonly ChartDrawingPoint[] = [];

export interface DrawingSettingsFormProps {
  /** What the tool declares; each part that has content earns a tab. */
  readonly settings: DrawingSettingsSchema;
  /** The settings the form starts from, inputs and flattened styles together, read once when the dialog opened. */
  readonly initialValues: ToolInputValues;
  /** The anchors the drawing holds, read once when the dialog opened; they fill the Coordinates tab. */
  readonly initialPoints?: readonly ChartDrawingPoint[];
  /** The timeframes the drawing paints on, read once when the dialog opened; it fills the Visibility tab. */
  readonly initialTimeframeVisibility?: DrawingTimeframeVisibility;
  /**
   * The edited settings, then the edited anchors and the edited timeframe setting, each only when it
   * differs from the stored one. Answers false when the tool refused the anchors: the form then stays
   * open with the user's edits and says so.
   */
  readonly onSave: (
    values: ToolInputValues,
    points?: readonly ChartDrawingPoint[],
    timeframeVisibility?: DrawingTimeframeVisibility,
  ) => boolean;
  readonly onCancel: () => void;
}

/**
 * The settings form itself, apart from the dialog shell so it can be mounted on its own: one tab per part
 * the tool declares, settings and anchors edited together, and OK disabled while any value or coordinate
 * still fails its kind.
 */
export function DrawingSettingsForm({
  settings,
  initialValues,
  initialPoints = NO_POINTS,
  initialTimeframeVisibility = DEFAULT_TIMEFRAME_VISIBILITY,
  onSave,
  onCancel,
}: DrawingSettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const coordinates = useCoordinateDraft(initialPoints, settings.points);
  const timeframeVisibility = useTimeframeVisibilityDraft(initialTimeframeVisibility);
  const change = (key: string, value: ToolInputValue) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const tabs = buildSettingsTabs(settings);
  const valid = areToolSettingValuesValid(settings, values) && coordinates.valid;
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (valid && !onSave(values, coordinates.changedPoints(), timeframeVisibility.changedValue())) {
      coordinates.reject();
      setSelectedTabId(COORDINATES_TAB_ID);
    }
  };
  return (
    <form className="drawing-settings" onSubmit={submit} noValidate>
      {tabs.length === 0 ? (
        <p className="drawing-settings-empty">This tool has no settings yet.</p>
      ) : (
        <SettingsTabs
          tabs={tabs}
          selectedId={selectedTabId}
          onSelect={setSelectedTabId}
          values={values}
          onChange={change}
          coordinates={coordinates}
          timeframeVisibility={timeframeVisibility}
        />
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
  readonly settings: DrawingSettingsSchema;
  readonly initialValues: ToolInputValues;
  readonly initialPoints: readonly ChartDrawingPoint[];
  readonly initialTimeframeVisibility: DrawingTimeframeVisibility;
  readonly onSave: DrawingSettingsFormProps['onSave'];
  readonly onClose: () => void;
}

/**
 * The settings dialog of one drawing. It is portalled to the page body because the chart frame is a
 * clipped stacking context: the modal has to cover the whole window, the tool rail included.
 */
export function DrawingSettingsDialog({
  label,
  settings,
  initialValues,
  initialPoints,
  initialTimeframeVisibility,
  onSave,
  onClose,
}: DrawingSettingsDialogProps) {
  return createPortal(
    <ModalDialog
      title={`${label} settings`}
      onDismiss={onClose}
      headerActions={<ModalDialogCloseButton label="Close drawing settings" onClick={onClose} />}
    >
      <DrawingSettingsForm
        settings={settings}
        initialValues={initialValues}
        initialPoints={initialPoints}
        initialTimeframeVisibility={initialTimeframeVisibility}
        onSave={onSave}
        onCancel={onClose}
      />
    </ModalDialog>,
    document.body,
  );
}
