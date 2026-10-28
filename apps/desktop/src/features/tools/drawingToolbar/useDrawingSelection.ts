import type { ChartDrawings } from '../../chart/engine/drawings/chartDrawings';
import type { ChartDrawingSelection } from '../../chart/engine/drawings/drawingRecord';
import { useChartDrawingsSnapshot } from '../useChartDrawingsSnapshot';

const subscribeToSelection = (drawings: ChartDrawings, onSelectionChanged: () => void) =>
  drawings.subscribeSelection(onSelectionChanged);

const readSelection = (drawings: ChartDrawings) => drawings.selected();

/**
 * The drawing the user has selected, or null. Every selection change the chart reports re-renders the
 * caller, and the snapshot is the chart's own selection object, which changes only with the selection.
 */
export function useDrawingSelection(): ChartDrawingSelection | null {
  return useChartDrawingsSnapshot(subscribeToSelection, readSelection, null);
}
