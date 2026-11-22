import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** Selects one of the chart's indicators, as a click on its object tree row does; it drops the drawing selection. */
export function useSelectIndicator(): (instanceId: string) => void {
  const { chart } = useChartResources();
  return (instanceId: string) => chart.current?.indicatorSelection.select(instanceId);
}
