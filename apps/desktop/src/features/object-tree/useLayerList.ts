import type { ChartDrawings, ChartLayerEntry } from '../chart/engine/drawings/chartDrawings';
import { useChartDrawingsSnapshot } from '../tools/useChartDrawingsSnapshot';

/** The list of a chart that is not there yet: the same array every read, which the store compares by identity. */
const NO_LAYERS: readonly ChartLayerEntry[] = [];

const subscribeToLayers = (drawings: ChartDrawings, onLayersChanged: () => void) =>
  drawings.subscribeLayerList(onLayersChanged);

const readLayers = (drawings: ChartDrawings) => drawings.layerList();

/**
 * Every layer of the chart, topmost first, which is the order an object tree prints them in: the
 * drawings around the price bars. The snapshot is the chart's cached list, so a re-render happens
 * only when the drawings change.
 */
export function useLayerList(): readonly ChartLayerEntry[] {
  return useChartDrawingsSnapshot(subscribeToLayers, readLayers, NO_LAYERS);
}
