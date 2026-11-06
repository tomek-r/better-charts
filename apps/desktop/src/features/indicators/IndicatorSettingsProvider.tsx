import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../chart/engine/drawings/timeframeVisibility';
import { indicatorSettingsSchema } from '../chart/engine/indicators/indicatorDisplaySettings';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../chart/engine/settings/settingsSchema';
import { SettingsForm, type SettingsFormProps } from '../chart/settingsForm/SettingsForm';
import { useRequiredContext } from '../../shared/context/useRequiredContext';
import { ModalDialog, ModalDialogCloseButton } from '../../shared/ui/dialog/ModalDialog';
import { useModalExit } from '../../shared/ui/dialog/useModalExit';
import { useRevertUnlessSettled } from '../../shared/ui/dialog/useRevertUnlessSettled';
import { findChartIndicatorPlugin, type RegisteredChartIndicatorPlugin } from './registry';
import { useIndicatorSettingsCommands } from './useIndicatorCommands';

/** What the app shares about indicator settings: the one command that opens them. */
interface IndicatorSettingsContextValue {
  readonly openIndicatorSettings: (instanceId: string) => void;
}

const IndicatorSettingsContext = createContext<IndicatorSettingsContextValue | null>(null);

/**
 * Opens the settings of one saved indicator, from an object tree row. The answers function keeps its
 * identity while the provider does, so the rows that hold it do not re-render when a dialog opens.
 */
export function useOpenIndicatorSettings(): (instanceId: string) => void {
  const { openIndicatorSettings } = useRequiredContext(
    IndicatorSettingsContext,
    'useOpenIndicatorSettings must be used within IndicatorSettingsProvider.',
  );
  return openIndicatorSettings;
}

interface IndicatorSettingsDialogProps {
  readonly instanceId: string;
  readonly onClose: () => void;
}

/** What the settings form reports for an indicator: it anchors nothing, so only the timeframes it shows on matter. */
type IndicatorSettingsSave = [points?: unknown, timeframeVisibility?: DrawingTimeframeVisibility];

/**
 * The settings dialog of one saved indicator, portalled to the page body for the same reason as the
 * drawing dialog: the chart frame is a clipped stacking context. Its Inputs and Style edits show on the
 * chart as they are made and are stored only on OK; every other way out reverts to the saved settings. An
 * indicator that detached, or whose definition left the registry, gives the dialog nothing to edit and no
 * dialog.
 */
function IndicatorSettingsDialog({ instanceId, onClose }: IndicatorSettingsDialogProps) {
  const { settings } = useChartSettings();
  const commands = useIndicatorSettingsCommands();
  const { backdropRef, closing, close } = useModalExit(onClose);
  const markSettled = useRevertUnlessSettled(commands.revertPreview);
  const saved = settings.indicators.find((entry) => entry.instanceId === instanceId);
  const plugin = saved === undefined ? undefined : findChartIndicatorPlugin(saved.definitionId);
  const cancel = () => {
    markSettled();
    commands.revertPreview();
    close();
  };
  const saveSettings = (values: SettingValues, ...[, timeframeVisibility]: IndicatorSettingsSave) => {
    commands.setSettings(instanceId, values, timeframeVisibility);
    markSettled();
    close();
    return true;
  };
  const previewDraft = (values: SettingValues) => commands.previewSettings(instanceId, values);
  if (saved === undefined || plugin === undefined) {
    return null;
  }
  return createPortal(
    <ModalDialog
      title={`${plugin.title} settings`}
      backdropClassName="drawing-settings-backdrop"
      backdropRef={backdropRef}
      closing={closing}
      onDismiss={cancel}
      headerActions={<ModalDialogCloseButton label="Close indicator settings" onClick={cancel} />}
    >
      <IndicatorSettingsFields
        plugin={plugin}
        saved={saved}
        closing={closing}
        onPreview={previewDraft}
        onSave={saveSettings}
        onCancel={cancel}
      />
    </ModalDialog>,
    document.body,
  );
}

interface IndicatorSettingsFieldsProps {
  readonly plugin: RegisteredChartIndicatorPlugin;
  readonly saved: SavedIndicator;
  readonly closing: boolean;
  readonly onPreview: (values: SettingValues) => void;
  readonly onSave: SettingsFormProps['onSave'];
  readonly onCancel: () => void;
}

/**
 * The form of one indicator's settings. It reads the values it starts from once, when it mounts, because a
 * preview rewrites the saved list the dialog was handed them from: what the form edits against, and what it
 * compares a draft with, stays the settings the dialog opened on.
 */
function IndicatorSettingsFields({
  plugin,
  saved,
  closing,
  onPreview,
  onSave,
  onCancel,
}: IndicatorSettingsFieldsProps) {
  const [initialValues] = useState(() => resolveSettingValues(indicatorSettingsSchema(plugin), saved.settings));
  const [initialTimeframeVisibility] = useState(() => saved.timeframeVisibility ?? DEFAULT_TIMEFRAME_VISIBILITY);
  return (
    <SettingsForm
      settings={{ ...plugin, ...indicatorSettingsSchema(plugin), timeframeVisibility: 'editable' }}
      initialValues={initialValues}
      initialTimeframeVisibility={initialTimeframeVisibility}
      // A draft still resting must not reach the chart once the dialog is leaving: OK kept it, Cancel reverted.
      onPreview={closing ? undefined : onPreview}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

export interface IndicatorSettingsProviderProps {
  readonly children: ReactNode;
}

/**
 * Holds the saved indicator whose settings are open, and renders that one dialog. It sits above the
 * chart and the object tree, so the tree opens a dialog the chart's settings keep in step.
 */
export function IndicatorSettingsProvider({ children }: IndicatorSettingsProviderProps) {
  const { settings } = useChartSettings();
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);

  const openIndicatorSettings = useCallback((instanceId: string) => {
    setOpenInstanceId(instanceId);
  }, []);

  const contextValue = useMemo(() => ({ openIndicatorSettings }), [openIndicatorSettings]);

  const closeSettings = () => {
    setOpenInstanceId(null);
  };

  // An indicator the user removed while its dialog was open leaves nothing to edit. Clearing the id here
  // rather than in the dialog keeps that dialog shut when an instance of the same id comes back.
  const openInstanceLeftSettings =
    openInstanceId !== null && !settings.indicators.some((entry) => entry.instanceId === openInstanceId);
  if (openInstanceLeftSettings) {
    setOpenInstanceId(null);
  }

  return (
    <IndicatorSettingsContext value={contextValue}>
      {children}
      {openInstanceId === null ? null : <IndicatorSettingsDialog instanceId={openInstanceId} onClose={closeSettings} />}
    </IndicatorSettingsContext>
  );
}
