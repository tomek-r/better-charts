import { useEffect } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useOpenIndicatorSettings } from './IndicatorSettingsProvider';
import { actionsMenuUnderButton } from './indicatorActionsMenu/indicatorActionsMenuRequest';
import { useOpenIndicatorActionsMenu } from './indicatorActionsMenu/IndicatorActionsMenuProvider';
import { useIndicatorRowCommands } from './useIndicatorCommands';

/**
 * Hands the chart's indicator legend the app's row commands while it is mounted: the legend asks to
 * open a settings dialog, to hide or show an indicator, to remove it, to open its actions menu, to save the
 * heights the pane separators were dragged to, or to save the collapse of its rows, and the app saves that so
 * the chart follows.
 */
export function ChartIndicatorLegendCommands() {
  const { chart } = useChartResources();
  const { setHidden, remove, setPaneHeights, setLegendCollapsed } = useIndicatorRowCommands();
  const openSettings = useOpenIndicatorSettings();
  const openIndicatorActionsMenu = useOpenIndicatorActionsMenu();

  useEffect(() => {
    if (chart.current === null) {
      return;
    }
    const controller = chart.current;
    controller.setIndicatorCommands({
      openSettings,
      setHidden,
      remove,
      setPaneHeights,
      setLegendCollapsed,
      openActionsMenu: (instanceId, button) => openIndicatorActionsMenu(actionsMenuUnderButton(instanceId, button)),
    });
    return () => controller.setIndicatorCommands(null);
  }, [chart, openIndicatorActionsMenu, openSettings, setHidden, remove, setPaneHeights, setLegendCollapsed]);

  return null;
}
