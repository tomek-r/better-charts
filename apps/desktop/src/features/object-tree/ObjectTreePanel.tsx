import type { ChartLayerEntry } from '../chart/engine/drawings/chartDrawings';
import type { ChartDrawingRecord, ChartDrawingSelection } from '../chart/engine/drawings/drawingRecord';
import { CHART_TOOL_PLUGINS } from '../tools/registry';
import { useDrawingSelection } from '../tools/drawingToolbar/useDrawingSelection';
import { ObjectTreeRow } from './ObjectTreeRow';
import { useLayerList } from './useLayerList';

/** Whether the chart holds this row's drawing: ids repeat across tools, so both halves must match. */
function isRecordSelected(selection: ChartDrawingSelection | null, record: ChartDrawingRecord): boolean {
  return selection !== null && selection.toolId === record.toolId && selection.drawingId === record.id;
}

/** The records of the layer list: the price bars have no row of their own yet. */
function drawingRecords(layers: readonly ChartLayerEntry[]): readonly ChartDrawingRecord[] {
  return layers.flatMap((layer) => (layer.kind === 'drawing' ? [layer.record] : []));
}

/**
 * The object tree drawer's body: the heading, then every drawing of the chart, topmost first. A tool
 * the app no longer knows has no row, because its label and icon come from the registry.
 */
export function ObjectTreePanel() {
  const layers = useLayerList();
  const drawings = drawingRecords(layers);
  const selection = useDrawingSelection();

  return (
    <>
      <h2 className="object-tree-title">Object tree</h2>
      {/* The list takes focus itself when a removal leaves no row to hand it to, so it always renders. */}
      <ul className="object-tree-list" aria-label="Drawings" tabIndex={-1}>
        {drawings.map((record) => {
          const plugin = CHART_TOOL_PLUGINS.find((entry) => entry.id === record.toolId);
          if (plugin === undefined) {
            return null;
          }
          return (
            <ObjectTreeRow
              key={`${record.toolId}:${record.id}`}
              record={record}
              plugin={plugin}
              selected={isRecordSelected(selection, record)}
            />
          );
        })}
      </ul>
      {drawings.length === 0 ? <p className="object-tree-empty">No drawings yet</p> : null}
    </>
  );
}
