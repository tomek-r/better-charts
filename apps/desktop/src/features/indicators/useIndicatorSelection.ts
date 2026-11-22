import { useSyncExternalStore } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** The unsubscribe of a chart that is not there yet; React calls the answer, so it is a function. */
const stopListening = (): void => undefined;

/**
 * The id of the indicator the user has selected, or null. The chart's own selection stays the one owner and
 * this only reads it, so every selection change the chart reports re-renders the caller. A chart that is not
 * there yet selects nothing.
 */
export function useIndicatorSelection(): string | null {
  const { chart } = useChartResources();
  const subscribe = (onChange: () => void) => chart.current?.indicatorSelection.subscribe(onChange) ?? stopListening;
  const read = () => chart.current?.indicatorSelection.selected() ?? null;
  return useSyncExternalStore(subscribe, read);
}
