import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../chart/engine/drawings/timeframeVisibility';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../chart/engine/settings/settingsSchema';
import { useRequiredContext } from '../../shared/context/useRequiredContext';
import { ModalDialog, ModalDialogCloseButton } from '../../shared/ui/dialog/ModalDialog';
import { DrawingSettingsForm } from '../tools/drawingSettings/DrawingSettingsDialog';
import { findChartIndicatorPlugin } from './registry';
import { useIndicatorCommands } from './useIndicatorCommands';

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
 * drawing dialog: the chart frame is a clipped stacking context. An indicator that detached, or whose
 * definition left the registry, gives the dialog nothing to edit and no dialog.
 */
function IndicatorSettingsDialog({ instanceId, onClose }: IndicatorSettingsDialogProps) {
  const { settings } = useChartSettings();
  const commands = useIndicatorCommands();
  const saved = settings.indicators.find((entry) => entry.instanceId === instanceId);
  const plugin = saved === undefined ? undefined : findChartIndicatorPlugin(saved.definitionId);
  if (saved === undefined || plugin === undefined) {
    return null;
  }
  const saveSettings = (values: SettingValues, ...[, timeframeVisibility]: IndicatorSettingsSave) => {
    commands.setSettings(instanceId, values, timeframeVisibility);
    onClose();
    return true;
  };
  return createPortal(
    <ModalDialog
      title={`${plugin.title} settings`}
      backdropClassName="drawing-settings-backdrop"
      onDismiss={onClose}
      headerActions={<ModalDialogCloseButton label="Close indicator settings" onClick={onClose} />}
    >
      <DrawingSettingsForm
        settings={{ ...plugin, timeframeVisibility: 'editable' }}
        initialValues={resolveSettingValues(plugin, saved.settings)}
        initialTimeframeVisibility={saved.timeframeVisibility ?? DEFAULT_TIMEFRAME_VISIBILITY}
        onSave={saveSettings}
        onCancel={onClose}
      />
    </ModalDialog>,
    document.body,
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
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);

  const openIndicatorSettings = useCallback((instanceId: string) => {
    setOpenInstanceId(instanceId);
  }, []);

  const contextValue = useMemo(() => ({ openIndicatorSettings }), [openIndicatorSettings]);

  const closeSettings = () => {
    setOpenInstanceId(null);
  };

  return (
    <IndicatorSettingsContext value={contextValue}>
      {children}
      {openInstanceId === null ? null : <IndicatorSettingsDialog instanceId={openInstanceId} onClose={closeSettings} />}
    </IndicatorSettingsContext>
  );
}
