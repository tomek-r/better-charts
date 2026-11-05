import { useEffect } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { syncIndicators } from './syncIndicators';

/**
 * The chart's indicator runtime follows the indicators its settings keep: a chart shows the indicators its
 * stored settings name, and attaching, changing or dropping one shows the change as soon as it is saved.
 */
export function ChartIndicatorSync() {
  const { settings } = useChartSettings();
  const { chart } = useChartResources();
  const { indicators } = settings;

  useEffect(() => {
    if (chart.current === null) {
      return;
    }
    syncIndicators(chart.current.indicators, indicators);
  }, [chart, indicators]);

  return null;
}
