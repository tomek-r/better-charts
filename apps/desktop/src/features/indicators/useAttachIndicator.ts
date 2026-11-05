import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { withIndicators } from '../chart/chartSettings/chartSettings';
import type { RegisteredChartIndicatorPlugin } from './registry';

/**
 * Adds an indicator to the chart with its default settings, by saving it with the chart's settings; the
 * chart's indicator runtime follows them, so the indicator shows as soon as the chart keeps it.
 */
export function useAttachIndicator(): (plugin: RegisteredChartIndicatorPlugin) => void {
  const { settings, keep } = useChartSettings();

  return (plugin) => {
    const indicator = { instanceId: crypto.randomUUID(), definitionId: plugin.id, settings: {} };
    keep(withIndicators(settings, [...settings.indicators, indicator]));
  };
}
