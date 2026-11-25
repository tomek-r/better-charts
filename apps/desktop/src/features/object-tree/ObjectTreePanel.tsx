import type { ChartDrawingRecord, ChartDrawingSelection } from '../chart/engine/drawings/drawingRecord';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { useIndicatorRowCommands } from '../indicators/useIndicatorCommands';
import { findChartToolPlugin } from '../tools/registry';
import { useDrawingSelection } from '../tools/drawingToolbar/useDrawingSelection';
import { ObjectTreeBarsRow } from './ObjectTreeBarsRow';
import { ObjectTreeIndicatorRow } from './ObjectTreeIndicatorRow';
import { ObjectTreeOwnPaneIndicators } from './ObjectTreeIndicators';
import { ObjectTreePaneGroup, PRICE_PANE_GROUP_LABEL, PRICE_PANE_LIST_LABEL } from './ObjectTreePaneGroup';
import { ObjectTreeRow } from './ObjectTreeRow';
import { pricePaneRowEdits, pricePaneRows, type PricePaneRow } from './pricePaneRows';
import { useLayerList } from './useLayerList';
import { useLayerReorder, type RowReorder } from './useLayerReorder';

/** Whether the chart holds this row's drawing: ids repeat across tools, so both halves must match. */
function isRecordSelected(selection: ChartDrawingSelection | null, record: ChartDrawingRecord): boolean {
  return selection !== null && selection.toolId === record.toolId && selection.drawingId === record.id;
}

/** The React key of one row: a drawing by tool and id, the bars as 'bars', an indicator by its instance id. */
function rowKey(row: PricePaneRow): string {
  if (row.kind === 'indicator') {
    return `indicator:${row.indicator.saved.instanceId}`;
  }
  const { layer } = row;
  return layer.kind === 'bars' ? 'bars' : `${layer.record.toolId}:${layer.record.id}`;
}

interface ObjectTreePricePaneRowProps {
  readonly row: PricePaneRow;
  readonly selected: ChartDrawingSelection | null;
  readonly reorder: RowReorder;
}

/** One row of the price pane: a drawing of any tool, the price bars, or an indicator the price pane draws. */
function ObjectTreePricePaneRow({ row, selected, reorder }: ObjectTreePricePaneRowProps) {
  if (row.kind === 'indicator') {
    return <ObjectTreeIndicatorRow saved={row.indicator.saved} plugin={row.indicator.plugin} reorder={reorder} />;
  }
  const { layer } = row;
  if (layer.kind === 'bars') {
    return <ObjectTreeBarsRow reorder={reorder} />;
  }
  const plugin = findChartToolPlugin(layer.record.toolId);
  if (plugin === undefined) {
    return null;
  }
  return (
    <ObjectTreeRow
      record={layer.record}
      plugin={plugin}
      selected={isRecordSelected(selected, layer.record)}
      reorder={reorder}
    />
  );
}

/**
 * The object tree drawer's body: the heading, then the panes of the chart as groups of rows, each group under the one
 * above it with a divider between. The price pane holds every row of the chart in one list, topmost first — the
 * drawings, the price-pane indicators and the price bars among them — so an indicator row dragged over the bars row
 * paints over the candles and one dragged under it paints under them; every pane after it holds the row of the
 * indicator that draws there. A tool the app no longer knows has no row, because its label and icon come from the
 * registry.
 */
export function ObjectTreePanel() {
  const layers = useLayerList();
  const { settings } = useChartSettings();
  const selection = useDrawingSelection();
  const { chart } = useChartResources();
  const { setPricePaneOrder } = useIndicatorRowCommands();
  const rows = pricePaneRows(layers, settings.indicators);
  const moveRow = (fromIndex: number, toIndex: number) => {
    const edits = pricePaneRowEdits(rows, fromIndex, toIndex);
    if (edits.layers !== undefined) {
      chart.current?.drawings.moveLayer(edits.layers.fromIndex, edits.layers.toIndex);
    }
    if (edits.indicators !== undefined) {
      setPricePaneOrder(edits.indicators.order, edits.indicators.aboveBars);
    }
  };
  const { forRow, listRef } = useLayerReorder(rows.length, moveRow);

  return (
    <>
      <h2 className="object-tree-title">Object tree</h2>
      <ObjectTreePaneGroup label={PRICE_PANE_GROUP_LABEL}>
        {/* The list takes focus itself when a removal leaves no row to hand it to, so it always renders. */}
        <ul ref={listRef} className="object-tree-list" aria-label={PRICE_PANE_LIST_LABEL} tabIndex={-1}>
          {rows.map((row, rowIndex) => (
            <ObjectTreePricePaneRow key={rowKey(row)} row={row} selected={selection} reorder={forRow(rowIndex)} />
          ))}
        </ul>
      </ObjectTreePaneGroup>
      <ObjectTreeOwnPaneIndicators />
    </>
  );
}
