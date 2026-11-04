import { useChartResources } from '../chart/ChartWorkspaceProvider';
import type { RegisteredChartIndicatorPlugin } from './registry';

/**
 * Attaches an indicator to the chart with its default settings; an attachment lives in memory only until
 * saving arrives with the chart's stored indicators.
 */
export function useAttachIndicator(): (plugin: RegisteredChartIndicatorPlugin) => void {
  const { chart } = useChartResources();

  return (plugin) => {
    chart.current?.indicators.attach(crypto.randomUUID(), plugin.id, undefined);
  };
}
