import { createContext, useCallback, useState, type ReactNode } from 'react';
import { useRequiredContext } from '../../../../shared/context/useRequiredContext';
import { CHART_SETTINGS_TABS } from './chartSettingsTabs';
import { ChartSettingsDialog } from './ChartSettingsDialog';

/** Opens the dialog, on the first of its tabs unless the caller names another one. */
type OpenChartSettings = (tabId?: string) => void;

/** The tab the dialog opens on when the caller names none: the first of its tabs. */
const FIRST_TAB_ID = CHART_SETTINGS_TABS[0].id;

const OpenChartSettingsContext = createContext<OpenChartSettings | null>(null);

/**
 * Owns the chart's settings dialog: the chart menu, the settings row of the Scales and lines menu and the
 * Settings button of the chart header all open this one. It sits around the chart workspace, which holds the
 * header and the frame with the menus that offer the settings.
 */
export function ChartSettingsDialogHost({ children }: { children: ReactNode }) {
  /** The tab the dialog was asked for; undefined while it is closed. */
  const [openTabId, setOpenTabId] = useState<string>();
  const openSettings = useCallback<OpenChartSettings>((tabId) => setOpenTabId(tabId ?? FIRST_TAB_ID), []);
  const closeSettings = useCallback(() => setOpenTabId(undefined), []);

  return (
    <OpenChartSettingsContext value={openSettings}>
      {children}
      {openTabId === undefined ? null : <ChartSettingsDialog initialTabId={openTabId} onClose={closeSettings} />}
    </OpenChartSettingsContext>
  );
}

/** Opens the chart's settings dialog from wherever it is offered: the chart menu, the Scales and lines menu,
 * or the header's Settings button. */
export function useOpenChartSettings(): OpenChartSettings {
  return useRequiredContext(
    OpenChartSettingsContext,
    'useOpenChartSettings must be used inside ChartSettingsDialogHost.',
  );
}
