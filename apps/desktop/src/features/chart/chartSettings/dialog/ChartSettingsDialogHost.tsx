import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRequiredContext } from '../../../../shared/context/useRequiredContext';
import { useChartResources } from '../../ChartWorkspaceProvider';
import { CHART_SETTINGS_REQUESTED_EVENT } from '../../engine/priceScale/chartSettingsCornerButton';
import { ChartSettingsDialog } from './ChartSettingsDialog';

const OpenChartSettingsContext = createContext<(() => void) | null>(null);

/**
 * Owns the chart's settings dialog: the chart menu and the gear in the chart's corner both open this one.
 * It sits around the chart frame, which holds the menu and the gear's event target, so the chart offers the settings.
 */
export function ChartSettingsDialogHost({ children }: { children: ReactNode }) {
  const { chartHost } = useChartResources();
  const [open, setOpen] = useState(false);
  const openSettings = useCallback(() => setOpen(true), []);
  const closeSettings = useCallback(() => setOpen(false), []);

  // The gear is a DOM button on the chart's own canvas, out of React's reach: it asks for the dialog with an
  // event raised on the chart's host, and this host only listens to it, so no engine value is written here.
  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    host.addEventListener(CHART_SETTINGS_REQUESTED_EVENT, openSettings);
    return () => host.removeEventListener(CHART_SETTINGS_REQUESTED_EVENT, openSettings);
  }, [chartHost, openSettings]);

  return (
    <OpenChartSettingsContext value={openSettings}>
      {children}
      {open ? <ChartSettingsDialog onClose={closeSettings} /> : null}
    </OpenChartSettingsContext>
  );
}

/** Opens the chart's settings dialog from wherever it is offered: the chart menu, or the gear on the chart. */
export function useOpenChartSettings(): () => void {
  return useRequiredContext(
    OpenChartSettingsContext,
    'useOpenChartSettings must be used inside ChartSettingsDialogHost.',
  );
}
