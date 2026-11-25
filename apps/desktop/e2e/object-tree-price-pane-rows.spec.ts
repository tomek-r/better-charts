import { expect, test } from '@playwright/test';
import type { ChartLayerEntry } from '../src/features/chart/engine/drawings/chartDrawings';
import { DEFAULT_TIMEFRAME_VISIBILITY } from '../src/features/chart/engine/drawings/timeframeVisibility';
import type { SavedIndicator } from '../src/features/chart/chartSettings/savedIndicators';
import { pricePaneRowEdits, pricePaneRows, type PricePaneRow } from '../src/features/object-tree/pricePaneRows';

/**
 * The rows of the price pane and what a move of one of them means: the tree prints the drawings, the price-pane
 * indicators and the price bars in one list, so a row moved over the bars row turns a drawing into one under the
 * candles and an indicator into one the chart paints under them. All of it is pure, so no browser is involved.
 */

/** The moving averages these cases list, with their rows' instance ids. */
const SAVED_SMA_9: SavedIndicator = { instanceId: 'sma-1', definitionId: 'sma', settings: {} };
const SAVED_EMA_9: SavedIndicator = { instanceId: 'ema-1', definitionId: 'ema', settings: {} };
const SAVED_EMA_UNDER_BARS: SavedIndicator = { ...SAVED_EMA_9, belowBars: true };

/** The bars marker of the chart's layer list. */
const BARS: ChartLayerEntry = { kind: 'bars' };

/** One drawing of the chart's layer list, which only its id matters for here. */
function drawing(id: string): ChartLayerEntry {
  return {
    kind: 'drawing',
    record: {
      id,
      toolId: 'fixed-range-volume-profile',
      locked: false,
      visible: true,
      belowBars: false,
      timeframeVisibility: DEFAULT_TIMEFRAME_VISIBILITY,
      settings: {},
      points: [{ timeMs: 1, price: null }],
    },
  };
}

/** The rows as plain keys, topmost first: an indicator by its instance id, a drawing by its id, the bars as 'bars'. */
function rowKeys(rows: readonly PricePaneRow[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'indicator') {
      return row.indicator.saved.instanceId;
    }
    return row.layer.kind === 'bars' ? 'bars' : row.layer.record.id;
  });
}

test('the price pane lists the indicators over the candles above the bars row and the rest under it', () => {
  const rows = pricePaneRows([drawing('top'), BARS, drawing('bottom')], [SAVED_SMA_9, SAVED_EMA_UNDER_BARS]);

  expect(rowKeys(rows)).toEqual(['top', 'sma-1', 'bars', 'ema-1', 'bottom']);
});

test('a chart without a saved indicator lists its drawings around the bars row alone', () => {
  const rows = pricePaneRows([drawing('top'), BARS, drawing('bottom')], []);

  expect(rowKeys(rows)).toEqual(['top', 'bars', 'bottom']);
});

test('moving an indicator over the bars row puts it over the candles and keeps the others in order', () => {
  const rows = pricePaneRows([BARS], [SAVED_SMA_9, SAVED_EMA_UNDER_BARS]);

  const edits = pricePaneRowEdits(rows, 2, 0);

  expect(edits).toEqual({ indicators: { order: ['ema-1', 'sma-1'], aboveBars: 2 } });
});

test('moving an indicator under the bars row puts every row it passes under the candles', () => {
  const rows = pricePaneRows([BARS], [SAVED_SMA_9, SAVED_EMA_9]);

  const edits = pricePaneRowEdits(rows, 0, 2);

  expect(edits).toEqual({ indicators: { order: ['ema-1', 'sma-1'], aboveBars: 1 } });
});

test('moving a drawing over the bars row moves it in the layer list and leaves the indicators alone', () => {
  const rows = pricePaneRows([drawing('top'), BARS, drawing('bottom')], [SAVED_SMA_9]);

  expect(pricePaneRowEdits(rows, 3, 0)).toEqual({ layers: { fromIndex: 2, toIndex: 0 } });
});

test('moving the bars row among the drawings moves it in the chart layer list too', () => {
  const rows = pricePaneRows([drawing('top'), BARS, drawing('bottom')], []);

  expect(pricePaneRowEdits(rows, 1, 2)).toEqual({ layers: { fromIndex: 1, toIndex: 2 } });
});

test('a row dropped on its own place changes nothing, and so does an index outside the list', () => {
  const rows = pricePaneRows([BARS], [SAVED_SMA_9]);

  expect(pricePaneRowEdits(rows, 1, 1)).toEqual({});
  expect(pricePaneRowEdits(rows, 0, 5)).toEqual({});
  expect(pricePaneRowEdits(rows, -1, 0)).toEqual({});
});
