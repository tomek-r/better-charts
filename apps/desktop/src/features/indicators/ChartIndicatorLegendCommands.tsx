import { useEffect } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useOpenIndicatorSettings } from './IndicatorSettingsProvider';
import { useIndicatorCommands } from './useIndicatorCommands';

/**
 * Hands the chart's indicator legend the app's row commands while it is mounted: the legend asks to
 * open a settings dialog, to hide or show an indicator, or to remove it, and the app saves that so
 * the chart follows.
 */
export function ChartIndicatorLegendCommands() {
  const { chart } = useChartResources();
  const { setHidden, remove } = useIndicatorCommands();
  const openSettings = useOpenIndicatorSettings();

  useEffect(() => {
    if (chart.current === null) {
      return;
    }
    const controller = chart.current;
    controller.setIndicatorCommands({ openSettings, setHidden, remove });
    return () => controller.setIndicatorCommands(null);
  }, [chart, openSettings, setHidden, remove]);

  return null;
}
