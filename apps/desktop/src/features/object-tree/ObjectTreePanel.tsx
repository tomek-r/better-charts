import type { ChartLayerEntry } from '../chart/engine/drawings/chartDrawings';
import type { ChartDrawingRecord, ChartDrawingSelection } from '../chart/engine/drawings/drawingRecord';
import { CHART_TOOL_PLUGINS } from '../tools/registry';
import { useDrawingSelection } from '../tools/drawingToolbar/useDrawingSelection';
import { ObjectTreeBarsRow } from './ObjectTreeBarsRow';
import { ObjectTreeRow } from './ObjectTreeRow';
import { useLayerList } from './useLayerList';
import { useLayerReorder } from './useLayerReorder';

/** Whether the chart holds this row's drawing: ids repeat across tools, so both halves must match. */
function isRecordSelected(selection: ChartDrawingSelection | null, record: ChartDrawingRecord): boolean {
  return selection !== null && selection.toolId === record.toolId && selection.drawingId === record.id;
}

/**
 * The object tree drawer's body: the heading, then every layer of the chart, topmost first: the
 * drawings and the price bars among them. A tool the app no longer knows has no row, because its
 * label and icon come from the registry.
 */
export function ObjectTreePanel() {
  const layers = useLayerList();
  const selection = useDrawingSelection();
  const { forRow, listRef } = useLayerReorder(layers.length);
  const hasDrawings = layers.some((layer) => layer.kind === 'drawing');

  const layerRow = (layer: ChartLayerEntry, layerIndex: number) => {
    if (layer.kind === 'bars') {
      return <ObjectTreeBarsRow key="bars" reorder={forRow(layerIndex)} />;
    }
    const { record } = layer;
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
        reorder={forRow(layerIndex)}
      />
    );
  };

  return (
    <>
      <h2 className="object-tree-title">Object tree</h2>
      {/* The list takes focus itself when a removal leaves no row to hand it to, so it always renders. */}
      <ul ref={listRef} className="object-tree-list" aria-label="Drawings" tabIndex={-1}>
        {layers.map(layerRow)}
      </ul>
      {hasDrawings ? null : <p className="object-tree-empty">No drawings yet</p>}
    </>
  );
}
