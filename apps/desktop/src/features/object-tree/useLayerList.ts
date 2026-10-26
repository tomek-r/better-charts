import { useSyncExternalStore } from 'react';
import type { ChartLayerEntry } from '../chart/engine/drawings/chartDrawings';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** The unsubscribe of a chart that is not there yet; React calls the answer, so it is a function. */
const subscribeNothing = (): (() => void) => () => undefined;

/** The list of a chart that is not there yet: the same array every read, which the store compares by identity. */
const NO_LAYERS: readonly ChartLayerEntry[] = [];

/**
 * Every layer of the chart, topmost first, which is the order an object tree prints them in: the
 * drawings around the price bars. The snapshot is the chart's cached list, so a re-render happens
 * only when the drawings change.
 */
export function useLayerList(): readonly ChartLayerEntry[] {
  const { chart } = useChartResources();
  const subscribe = (onLayersChanged: () => void) =>
    chart.current?.drawings.subscribeLayerList(onLayersChanged) ?? subscribeNothing();
  const layers = () => chart.current?.drawings.layerList() ?? NO_LAYERS;
  return useSyncExternalStore(subscribe, layers);
}
