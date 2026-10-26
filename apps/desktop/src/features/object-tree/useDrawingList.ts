import { useSyncExternalStore } from 'react';
import type { ChartDrawingRecord } from '../chart/engine/drawings/drawingRecord';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** The unsubscribe of a chart that is not there yet; React calls the answer, so it is a function. */
const subscribeNothing = (): (() => void) => () => undefined;

/** The list of a chart that is not there yet: the same array every read, which the store compares by identity. */
const NO_DRAWINGS: readonly ChartDrawingRecord[] = [];

/**
 * Every drawing of the chart, topmost first, which is the order an object tree prints them in. The
 * snapshot is the chart's cached list, so a re-render happens only when the drawings change.
 */
export function useDrawingList(): readonly ChartDrawingRecord[] {
  const { chart } = useChartResources();
  const subscribe = (onDrawingsChanged: () => void) =>
    chart.current?.drawings.subscribeDrawingList(onDrawingsChanged) ?? subscribeNothing();
  const drawings = () => chart.current?.drawings.drawingList() ?? NO_DRAWINGS;
  return useSyncExternalStore(subscribe, drawings);
}
