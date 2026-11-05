import { useEffect, useEffectEvent, useRef, useState, type SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ChartDrawingPoint } from '../../chart/engine/drawings/drawingRecord';
import type { SettingValue, SettingValues } from '../../chart/engine/settings/settingInputs';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../../chart/engine/drawings/timeframeVisibility';
import {
  areSettingValuesValid,
  withStoredValuesForInvalidInactiveInputs,
} from '../../chart/engine/settings/settingsSchema';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../../shared/ui/dialog/ModalDialog';
import { useModalExit } from '../../../shared/ui/dialog/useModalExit';
import { SettingsTabs } from './SettingsTabs';
import { buildSettingsTabs, COORDINATES_TAB_ID, type DrawingSettingsSchema } from './settingsTabModel';
import { useCoordinateDraft } from './coordinates/useCoordinateDraft';
import { useDebouncedPreview } from './useDebouncedPreview';
import { useTimeframeVisibilityDraft } from './visibility/useTimeframeVisibilityDraft';

/** The no-anchor default, one list so a form without anchors keeps a stable prop. */
const NO_POINTS: readonly ChartDrawingPoint[] = [];

export interface DrawingSettingsFormProps {
  /** What the tool declares; each part that has content earns a tab. */
  readonly settings: DrawingSettingsSchema;
  /** The settings the form starts from, inputs and flattened styles together, read once when the dialog opened. */
  readonly initialValues: SettingValues;
  /** The anchors the drawing holds, read once when the dialog opened; they fill the Coordinates tab. */
  readonly initialPoints?: readonly ChartDrawingPoint[];
  /** The timeframes the drawing paints on, read once when the dialog opened; it fills the Visibility tab. */
  readonly initialTimeframeVisibility?: DrawingTimeframeVisibility;
  /**
   * Called with the draft, as OK would save it, once the edits have rested for `PREVIEW_DELAY_MS` while every
   * value is valid; a form without it previews nothing.
   */
  readonly onPreview?: (values: SettingValues) => void;
  /**
   * The edited settings, then the edited anchors and the edited timeframe setting, each only when it
   * differs from the stored one. Answers false when the tool refused the anchors: the form then stays
   * open with the user's edits and says so.
   */
  readonly onSave: (
    values: SettingValues,
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
  onPreview,
  onSave,
  onCancel,
}: DrawingSettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const [selectedTabId, setSelectedTabId] = useState<string | undefined>(undefined);
  const coordinates = useCoordinateDraft(initialPoints, settings.points);
  const timeframeVisibility = useTimeframeVisibilityDraft(initialTimeframeVisibility);
  useDebouncedPreview(values, initialValues, settings, onPreview);
  const change = (key: string, value: SettingValue) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const tabs = buildSettingsTabs(settings);
  const valid = areSettingValuesValid(settings, values) && coordinates.valid;
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const savedValues = withStoredValuesForInvalidInactiveInputs(settings, values, initialValues);
    if (valid && !onSave(savedValues, coordinates.changedPoints(), timeframeVisibility.changedValue())) {
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
          settings={settings}
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
  readonly initialValues: SettingValues;
  readonly initialPoints: readonly ChartDrawingPoint[];
  readonly initialTimeframeVisibility: DrawingTimeframeVisibility;
  /** Shows the draft on the drawing once the edits rest, without saving it. */
  readonly onPreview: (values: SettingValues) => void;
  /** Puts the stored settings back on the drawing, undoing a preview. */
  readonly onRevert: () => void;
  readonly onSave: DrawingSettingsFormProps['onSave'];
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
  /** Whether the dialog leaves through OK or Cancel, which have already settled the drawing themselves. */
  const settled = useRef(false);
  const revertUnlessSettled = useEffectEvent(() => {
    if (!settled.current) {
      onRevert();
    }
  });
  // A selection that moved off the drawing unmounts the dialog with no close at all, so an unmount that
  // neither saved nor cancelled drops the preview and shows the stored settings again.
  useEffect(() => revertUnlessSettled, []);
  const save: DrawingSettingsFormProps['onSave'] = (values, points, timeframeVisibility) => {
    // The tool's answer decides it: a refused anchor keeps the form open, a saved one lets it leave.
    if (!onSave(values, points, timeframeVisibility)) {
      return false;
    }
    settled.current = true;
    close();
    return true;
  };
  const cancel = () => {
    settled.current = true;
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
      <DrawingSettingsForm
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
