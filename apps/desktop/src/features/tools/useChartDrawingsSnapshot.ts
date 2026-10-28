import { useSyncExternalStore } from 'react';
import type { ChartDrawings } from '../chart/engine/drawings/chartDrawings';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** The unsubscribe of a chart that is not there yet; React calls the answer, so it is a function. */
const subscribeNothing = (): (() => void) => () => undefined;

/**
 * Reads one value of the chart's drawings as an external store. `subscribeToDrawings` and `readDrawings`
 * must keep their identity (module-level functions) so React does not resubscribe on every render.
 * `noChartSnapshot` is what a chart that is not there yet reads as, and must be the same value every
 * read because the store compares snapshots by identity.
 */
export function useChartDrawingsSnapshot<Snapshot>(
  subscribeToDrawings: (drawings: ChartDrawings, onChange: () => void) => () => void,
  readDrawings: (drawings: ChartDrawings) => Snapshot,
  noChartSnapshot: Snapshot,
): Snapshot {
  const { chart } = useChartResources();
  const subscribe = (onChange: () => void) => {
    const drawings = chart.current?.drawings;
    return drawings === undefined ? subscribeNothing() : subscribeToDrawings(drawings, onChange);
  };
  const read = () => {
    const drawings = chart.current?.drawings;
    return drawings === undefined ? noChartSnapshot : readDrawings(drawings);
  };
  return useSyncExternalStore(subscribe, read);
}
