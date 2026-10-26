import { useSyncExternalStore } from 'react';
import type { ChartDrawingSelection } from '../../chart/engine/drawings/drawingRecord';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';

/** The unsubscribe of a chart that is not there yet; React calls the answer, so it is a function. */
const subscribeNothing = (): (() => void) => () => undefined;

/**
 * The drawing the user has selected, or null. Every selection change the chart reports re-renders the
 * caller, and the snapshot is the chart's own selection object, which changes only with the selection.
 */
export function useDrawingSelection(): ChartDrawingSelection | null {
  const { chart } = useChartResources();
  const subscribe = (onSelectionChanged: () => void) =>
    chart.current?.drawings.subscribeSelection(onSelectionChanged) ?? subscribeNothing();
  const selection = () => chart.current?.drawings.selected() ?? null;
  return useSyncExternalStore(subscribe, selection);
}
