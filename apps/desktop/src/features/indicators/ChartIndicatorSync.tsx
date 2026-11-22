import { useEffect } from 'react';
import { useBridgeChartState } from '../bridge/bridgeSelectors';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { indicatorsShownOn } from './indicatorsOnTimeframe';
import { syncIndicators } from './syncIndicators';

/**
 * The chart's indicator runtime follows the indicators its settings keep on the chart's timeframe: a chart shows
 * the indicators its stored settings name and its timeframe grants, and attaching, changing, dropping or limiting
 * one shows the change as soon as it is saved or the chart switches timeframe. Their saved order is the order of
 * the object tree's rows, topmost first, which the chart paints as its series order.
 */
export function ChartIndicatorSync() {
  const { settings } = useChartSettings();
  const { chart } = useChartResources();
  const { timeframe } = useBridgeChartState();
  const { indicators } = settings;

  useEffect(() => {
    if (chart.current === null) {
      return;
    }
    const shownIndicators = indicatorsShownOn(indicators, timeframe);
    syncIndicators(chart.current.indicators, shownIndicators);
    chart.current.indicators.setPaintOrder(shownIndicators.map((indicator) => indicator.instanceId));
  }, [chart, indicators, timeframe]);

  return null;
}
