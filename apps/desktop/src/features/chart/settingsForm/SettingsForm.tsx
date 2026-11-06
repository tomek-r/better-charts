import { useState, type SubmitEvent } from 'react';
import type { ChartDrawingPoint } from '../engine/drawings/drawingRecord';
import type { SettingValue, SettingValues } from '../engine/settings/settingInputs';
import { DEFAULT_TIMEFRAME_VISIBILITY, type DrawingTimeframeVisibility } from '../engine/drawings/timeframeVisibility';
import { areSettingValuesValid, withStoredValuesForInvalidInactiveInputs } from '../engine/settings/settingsSchema';
import { ModalDialogButton } from '../../../shared/ui/dialog/ModalDialog';
import { SettingsTabs } from './SettingsTabs';
import { buildSettingsTabs, COORDINATES_TAB_ID, type SettingsFormSchema } from './settingsTabModel';
import { useCoordinateDraft } from './coordinates/useCoordinateDraft';
import { useDebouncedPreview } from './useDebouncedPreview';
import { useTimeframeVisibilityDraft } from './visibility/useTimeframeVisibilityDraft';

/** The no-anchor default, one list so a form without anchors keeps a stable prop. */
const NO_POINTS: readonly ChartDrawingPoint[] = [];

export interface SettingsFormProps {
  /** What the tool declares; each part that has content earns a tab. */
  readonly settings: SettingsFormSchema;
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
export function SettingsForm({
  settings,
  initialValues,
  initialPoints = NO_POINTS,
  initialTimeframeVisibility = DEFAULT_TIMEFRAME_VISIBILITY,
  onPreview,
  onSave,
  onCancel,
}: SettingsFormProps) {
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
