import { expect, test } from '@playwright/test';
import { createFakeMarketDataPort } from './helpers/fakeMarketDataPort';
import { DEFAULT_PROFILE_REQUEST_PARAMS } from '../src/features/tools/fixedRangeProfile/requests/fixedRangeProfileRequester';
import { ChartDrawingCollection } from '../src/features/chart/engine/drawings/chartDrawingCollection';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import { resolveToolSettingValues } from '../src/features/chart/engine/drawings/toolSettings';
import type { ChartToolHost } from '../src/features/chart/engine/tools/toolContract';
import { FixedRangeProfileDrawing } from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfileDrawing';
import { FIXED_RANGE_PROFILE_POINTS } from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfilePoints';
import { TickProfileRequestQueue } from '../src/features/tools/fixedRangeProfile/requests/tickProfileRequestQueue';
import {
  FIXED_RANGE_PROFILE_INPUTS,
  FIXED_RANGE_PROFILE_STYLES,
  readFixedRangeProfileSettings,
} from '../src/features/tools/fixedRangeProfile/settings';

/**
 * The settings that feed the computation (rows, value area) become the profile request and re-request it when
 * they change; every other setting only repaints. Pure Node: a fake port records what the drawing sends.
 */

const SYMBOL = 'DEMO.TEST';
const FROM_MS = Date.now() - 600_000;
const END_MS = FROM_MS + 300_000;
const DEFAULT_VALUES = resolveToolSettingValues(
  { inputs: FIXED_RANGE_PROFILE_INPUTS, styles: FIXED_RANGE_PROFILE_STYLES },
  undefined,
);

/** A collection holding one visible drawing, with the market port that records its requests. */
function holdOneDrawing(storedInputs: ToolInputValues = {}) {
  const market = createFakeMarketDataPort();
  const queue = new TickProfileRequestQueue(market.port);
  // Only the host members the request path reads.
  const host = {
    currentMarket: { symbol: () => SYMBOL, quote: () => null },
    barSeries: { bars: [{ time: (END_MS + 60_000) / 1000 }], timeframe: 'M1', intervalSeconds: 60 },
    requestRepaint: () => undefined,
    notifyError: () => undefined,
  } as unknown as ChartToolHost;
  const collection = new ChartDrawingCollection<FixedRangeProfileDrawing>(
    { inputs: FIXED_RANGE_PROFILE_INPUTS, styles: FIXED_RANGE_PROFILE_STYLES, points: FIXED_RANGE_PROFILE_POINTS },
    { restore: () => undefined },
    () => undefined,
  );
  const drawing = FixedRangeProfileDrawing.restored(host, queue, { fromMs: FROM_MS, endMs: END_MS }, FROM_MS);
  const id = collection.add(drawing, { inputs: storedInputs });
  const rowsAndValueArea = () =>
    market.requests.map(({ rowsLayout, valueAreaPercent }) => ({ rowsLayout, valueAreaPercent }));
  return { collection, market, id, rowsAndValueArea };
}

test('the schema defaults map to 128 rows and a 70 percent value area', () => {
  expect(readFixedRangeProfileSettings(undefined).requestParams).toEqual(DEFAULT_PROFILE_REQUEST_PARAMS);
});

test('a number-of-rows layout sends the row count, a ticks-per-row layout the tick count', () => {
  const byCount = readFixedRangeProfileSettings({ rowsLayout: 'Number Of Rows', rowCount: 40, ticksPerRow: 9 });
  const byTicks = readFixedRangeProfileSettings({ rowsLayout: 'Ticks Per Row', rowCount: 40, ticksPerRow: 9 });
  expect(byCount.requestParams.rowsLayout).toEqual({ kind: 'rows', count: 40 });
  expect(byTicks.requestParams.rowsLayout).toEqual({ kind: 'ticksPerRow', ticks: 9 });
});

test('the value area percent is sent as stored', () => {
  expect(readFixedRangeProfileSettings({ valueAreaPercent: 55 }).requestParams.valueAreaPercent).toBe(55);
});

test('values outside their bounds resolve to the defaults', () => {
  const settings = readFixedRangeProfileSettings({ rowCount: 500, valueAreaPercent: 0, rowsLayout: 'Rows' });
  expect(settings.requestParams).toEqual(DEFAULT_PROFILE_REQUEST_PARAMS);
});

test('a drawing saved before any setting existed requests 128 rows and a 70 percent value area', () => {
  const { market, rowsAndValueArea } = holdOneDrawing({});
  expect(market.requests).toHaveLength(1);
  expect(rowsAndValueArea()).toEqual([{ rowsLayout: { kind: 'rows', count: 128 }, valueAreaPercent: 70 }]);
});

test('a drawing stored with its own rows asks for them in its first request', () => {
  const { rowsAndValueArea } = holdOneDrawing({ rowsLayout: 'Ticks Per Row', ticksPerRow: 7, valueAreaPercent: 80 });
  expect(rowsAndValueArea()).toEqual([{ rowsLayout: { kind: 'ticksPerRow', ticks: 7 }, valueAreaPercent: 80 }]);
});

test('changing the row count, the layout or the value area asks for the profile again', () => {
  const { collection, id, rowsAndValueArea } = holdOneDrawing();
  collection.setInputs(id, { ...DEFAULT_VALUES, rowCount: 64 });
  collection.setInputs(id, { ...DEFAULT_VALUES, rowCount: 64, rowsLayout: 'Ticks Per Row', ticksPerRow: 5 });
  collection.setInputs(id, {
    ...DEFAULT_VALUES,
    rowCount: 64,
    rowsLayout: 'Ticks Per Row',
    ticksPerRow: 5,
    valueAreaPercent: 90,
  });
  expect(rowsAndValueArea()).toEqual([
    { rowsLayout: { kind: 'rows', count: 128 }, valueAreaPercent: 70 },
    { rowsLayout: { kind: 'rows', count: 64 }, valueAreaPercent: 70 },
    { rowsLayout: { kind: 'ticksPerRow', ticks: 5 }, valueAreaPercent: 70 },
    { rowsLayout: { kind: 'ticksPerRow', ticks: 5 }, valueAreaPercent: 90 },
  ]);
});

const RENDER_ONLY_CHANGES: ReadonlyArray<{ name: string; change: ToolInputValues }> = [
  { name: 'a colour', change: { 'upVolume.color': '#112233' } },
  { name: 'the histogram box colour', change: { 'histogramBox.color': '#11223344' } },
  { name: 'the values labels being shown', change: { 'values.visible': true } },
  { name: 'a level line colour', change: { 'poc.color': '#445566' } },
  { name: 'a level line being hidden', change: { 'vah.visible': false } },
  { name: 'a level line style', change: { 'val.style': 'dotted' } },
  { name: 'the width percent', change: { widthPercent: 35 } },
  { name: 'the values position', change: { valuesPosition: 'Opposite Side' } },
  { name: 'the placement', change: { placement: 'Right' } },
  { name: 'the volume mode', change: { volume: 'Delta' } },
  { name: 'extend right', change: { extendRight: false } },
];

for (const { name, change } of RENDER_ONLY_CHANGES) {
  test(`changing ${name} repaints without a new request`, () => {
    const { collection, market, id } = holdOneDrawing();
    collection.setInputs(id, { ...DEFAULT_VALUES, ...change });
    expect(market.requests).toHaveLength(1);
  });
}

test('the width percent accepts 1 to 100 and falls back to 20 outside them', () => {
  const widthOf = (widthPercent: number) => readFixedRangeProfileSettings({ widthPercent }).appearance.widthPercent;
  expect([widthOf(1), widthOf(100)]).toEqual([1, 100]);
  expect([widthOf(0), widthOf(101)]).toEqual([20, 20]);
});

test('an inactive field changes nothing the backend would compute', () => {
  const { collection, market, id } = holdOneDrawing();
  collection.setInputs(id, { ...DEFAULT_VALUES, ticksPerRow: 40 });
  expect(market.requests).toHaveLength(1);
});

test('a hidden drawing asks for nothing until it is shown again, then with the new rows', () => {
  const { collection, id, rowsAndValueArea } = holdOneDrawing();
  collection.setVisible(id, false);
  collection.setInputs(id, { ...DEFAULT_VALUES, rowCount: 32 });
  expect(rowsAndValueArea()).toHaveLength(1);
  collection.setVisible(id, true);
  expect(rowsAndValueArea().at(-1)).toEqual({ rowsLayout: { kind: 'rows', count: 32 }, valueAreaPercent: 70 });
});
