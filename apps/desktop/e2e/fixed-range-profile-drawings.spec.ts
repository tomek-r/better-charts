import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import { createFakeToolHost, oneMinuteBars, SLOT_WIDTH_PX, FAKE_SYMBOL } from './helpers/fakeToolHost';
import { FixedRangeProfileTool } from '../src/features/tools/fixedRangeProfile/tool';
import { readFixedRangeProfilePoints } from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfilePoints';
import type { ChartDrawingPaintTarget } from '../src/features/chart/engine/tools/toolContract';

/**
 * Many independent drawings of one tool: two placements no longer replace each other, each drawing has
 * its own id, lock, visibility, settings and request, and a press, a delete, a hide or a drag addresses
 * exactly one of them. The tool keeps its gestures and its paint; the engine's collection keeps the
 * drawings themselves.
 *
 * The fake series is ten one-minute bars from 1_020 s, so a click at slot * SLOT_WIDTH_PX lands on that
 * bar and a two-click placement commits the bar window it spans.
 */

const PANE_Y = 200;
/** Slots 2..6: the window [1_140_000, 1_440_000) ms, handles at x 20 and 60. */
const FIRST_CLICKS = [25, 65];
/** Slots 8..9: the window [1_500_000, 1_620_000) ms, handles at x 80 and 90. */
const SECOND_CLICKS = [85, 95];
const FIRST_FROM_X = 20;
const SECOND_FROM_X = 80;
/** Pane x no drawing covers and no handle reaches: ten pixels from either band. */
const GAP_X = 70;

function createSession() {
  const market = createFakeMarketDataPort();
  const fakeHost = createFakeToolHost(market.port);
  const tool = new FixedRangeProfileTool(fakeHost.host);
  const place = (clicks: readonly number[]) => {
    for (const x of clicks) {
      tool.pointerDown(x, PANE_Y, 'startNewDrawing');
      tool.pointerUp('released');
    }
  };
  return { market, fakeHost, tool, place };
}

type Session = ReturnType<typeof createSession>;

/** Answers the request in flight, which lets the next waiting drawing's request leave. */
function answerInFlight({ market }: Session): void {
  market.publisher.publishTickProfile(profileResultFor(market.requests[market.requests.length - 1], FAKE_SYMBOL));
}

/** The handle circles one paint pass draws: two per visible drawing, none for a hidden one. */
function paintedHandles({ tool, fakeHost }: Session): number {
  let arcs = 0;
  const context = {
    save: () => undefined,
    restore: () => undefined,
    setLineDash: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    arc: () => {
      arcs += 1;
    },
  } as unknown as CanvasRenderingContext2D;
  const target = {
    context,
    viewport: fakeHost.host.geometry.viewport(),
  } as ChartDrawingPaintTarget;
  // The engine paints only the drawings it finds visible, in the chart's stacking order.
  for (const drawingId of tool.drawings.drawingIds()) {
    if (tool.drawings.isVisible(drawingId)) {
      tool.drawDrawing(target, drawingId);
    }
  }
  return arcs;
}

/** The ids of a tool's drawings, bottom to top. */
function drawingIds(tool: FixedRangeProfileTool): string[] {
  return tool
    .testApi()
    .drawings()
    .map((drawing) => drawing.id);
}

test('two placements keep two drawings and report each new id once', () => {
  const { tool, fakeHost, place } = createSession();
  place(FIRST_CLICKS);
  place(SECOND_CLICKS);
  const drawings = tool.testApi().drawings();
  expect(drawings).toHaveLength(2);
  expect(drawings[0].id).not.toBe(drawings[1].id);
  expect(fakeHost.placedIds).toEqual([drawings[0].id, drawings[1].id]);
  expect(fakeHost.changeCount()).toBe(0);
  expect(drawings.map((drawing) => drawing.locked)).toEqual([false, false]);
  expect(drawings[0].range).toEqual({ fromMs: 1_140_000, endMs: 1_440_000 });
  expect(drawings[1].range).toEqual({ fromMs: 1_500_000, endMs: 1_620_000 });
});

test('the second drawing asks for its profile only once the first one answered', () => {
  const session = createSession();
  session.place(FIRST_CLICKS);
  session.place(SECOND_CLICKS);
  expect(session.market.requests).toHaveLength(1);
  answerInFlight(session);
  expect(session.market.requests.map((request) => request.fromMs)).toEqual([1_140_000, 1_500_000]);
});

test('hits answers over a drawing band and nothing outside it', () => {
  const { tool, place } = createSession();
  place(FIRST_CLICKS);
  place(SECOND_CLICKS);
  const [first, second] = tool.testApi().drawings();
  expect(tool.drawings.hits(first.id, FIRST_FROM_X + 5, PANE_Y)).toBe(true);
  expect(tool.drawings.hits(second.id, SECOND_FROM_X + 5, PANE_Y)).toBe(true);
  expect(tool.drawings.hits(first.id, GAP_X, PANE_Y)).toBe(false);
  expect(tool.drawings.hits(first.id, FIRST_FROM_X + 5, 500)).toBe(false);
  // A later drawing over the same window is on top of the earlier one.
  place(FIRST_CLICKS);
  expect(tool.drawings.drawingIds().at(-1)).toBe(tool.testApi().drawings()[2].id);
  expect(tool.drawings.hits(tool.testApi().drawings()[2].id, FIRST_FROM_X + 5, PANE_Y)).toBe(true);
});

test('a hidden drawing is not painted, and paints its handles again once shown', () => {
  const session = createSession();
  session.place(FIRST_CLICKS);
  const [drawing] = session.tool.testApi().drawings();
  expect(paintedHandles(session)).toBe(2);

  session.tool.drawings.setVisible(drawing.id, false);
  expect(paintedHandles(session)).toBe(0);

  session.tool.drawings.setVisible(drawing.id, true);
  expect(paintedHandles(session)).toBe(2);
});

test('a hidden drawing is not hit and its handle starts no drag', () => {
  const session = createSession();
  session.place(FIRST_CLICKS);
  const [drawing] = session.tool.testApi().drawings();
  session.tool.drawings.setVisible(drawing.id, false);

  expect(session.tool.drawings.hits(drawing.id, FIRST_FROM_X, PANE_Y)).toBe(false);
  expect(session.tool.pointerDown(FIRST_FROM_X, PANE_Y, 'editExistingDrawing')).toBe(false);
});

test('hiding a drawing whose request waits drops it from the queue, showing it asks again', () => {
  const session = createSession();
  session.place(FIRST_CLICKS);
  session.place(SECOND_CLICKS);
  const [, second] = session.tool.testApi().drawings();

  session.tool.drawings.setVisible(second.id, false);
  expect(session.market.cancelCount()).toBe(0);
  answerInFlight(session);
  expect(session.market.requests).toHaveLength(1);

  session.tool.drawings.setVisible(second.id, true);
  expect(session.market.requests.map((request) => request.fromMs)).toEqual([1_140_000, 1_500_000]);
});

/** Two placed drawings whose first profile request was answered, so the second one is in flight. */
function sessionWithTwoDrawings() {
  const session = createSession();
  session.place(FIRST_CLICKS);
  session.place(SECOND_CLICKS);
  answerInFlight(session);
  const [first, second] = session.tool.testApi().drawings();
  return { session, first, second };
}

test('a locked drawing ignores its handle while an unlocked one commits one reported edit', () => {
  const { session, first, second } = sessionWithTwoDrawings();
  expect(session.tool.drawings.setLocked(first.id, true)).toBe(true);
  expect(session.tool.pointerDown(FIRST_FROM_X, PANE_Y, 'editExistingDrawing')).toBe(false);
  expect(session.tool.testApi().drawings()[0].range).toEqual(first.range);
  expect(session.tool.pointerDown(SECOND_FROM_X, PANE_Y, 'editExistingDrawing')).toBe(true);
  session.tool.pointerMove(SECOND_FROM_X + SLOT_WIDTH_PX);
  session.tool.pointerUp('released');
  expect(session.fakeHost.changeCount()).toBe(1);
  expect(session.tool.testApi().drawings()[1].range).toEqual({ fromMs: 1_560_000, endMs: 1_620_000 });
  expect(second.locked).toBe(false);
});

test('deleting one drawing removes it and cancels only its own request', () => {
  const { session, first, second } = sessionWithTwoDrawings();
  expect(session.tool.drawings.delete(first.id)).toBe(true);
  expect(drawingIds(session.tool)).toEqual([second.id]);
  expect(session.market.cancelCount()).toBe(0);
  expect(session.tool.drawings.delete(second.id)).toBe(true);
  expect(session.tool.testApi().drawings()).toEqual([]);
  expect(session.market.cancelCount()).toBe(1);
  expect(session.tool.drawings.delete(second.id)).toBe(false);
});

test('an export imports into a fresh tool that asks for each profile without reporting anything', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  source.place(SECOND_CLICKS);
  const records = source.tool.drawings.exportRecords();
  expect(records).toHaveLength(2);
  const target = createSession();
  target.tool.drawings.importRecords(records);
  expect(target.tool.drawings.exportRecords()).toEqual(records);
  expect(target.fakeHost.placedIds).toEqual([]);
  expect(target.fakeHost.changeCount()).toBe(0);
  expect(target.market.requests).toHaveLength(1);
  answerInFlight(target);
  const restoredFrom = records.map((record) => readFixedRangeProfilePoints(record.points)?.fromMs);
  expect(target.market.requests.map((request) => request.fromMs)).toEqual(restoredFrom);
});

test('a stored drawing exports the points, the lock and the visibility it arrived with', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const [record] = source.tool.drawings.exportRecords();
  expect(record.visible).toBe(true);
  expect(record.points).toEqual([
    { timeMs: 1_140_000, price: null },
    { timeMs: 1_440_000, price: null },
  ]);

  const target = createSession();
  target.tool.drawings.importRecords([{ ...record, visible: false }]);

  expect(target.tool.drawings.exportRecords()).toEqual([{ ...record, visible: false }]);
  expect(target.market.requests).toEqual([]);
});

test('a stored drawing with second-precision anchors loads on whole minutes and requests whole minutes', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const [record] = source.tool.drawings.exportRecords();
  const [start, end] = record.points;
  const target = createSession();
  target.tool.drawings.importRecords([
    {
      ...record,
      points: [
        { ...start, timeMs: (start.timeMs ?? 0) + 40_000 },
        { ...end, timeMs: (end.timeMs ?? 0) + 20_000 },
      ],
    },
  ]);

  // 40 s past the start rounds up to the next minute, 20 s past the end rounds down to the end.
  expect(target.tool.drawings.exportRecords()[0].points).toEqual([
    { timeMs: (start.timeMs ?? 0) + 60_000, price: null },
    { timeMs: end.timeMs, price: null },
  ]);
  expect(target.market.requests).toHaveLength(1);
  expect(target.market.requests[0].fromMs % 60_000).toBe(0);
  expect(target.market.requests[0].endMs % 60_000).toBe(0);
});

test('an import drops a record whose points do not name a window', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const [record] = source.tool.drawings.exportRecords();
  const target = createSession();
  const [start, end] = record.points;
  target.tool.drawings.importRecords([
    record,
    { ...record, id: 'reversed', points: [end, start] },
    { ...record, id: 'priced', points: [{ ...start, price: '1.0850' }, end] },
  ]);

  expect(drawingIds(target.tool)).toEqual([record.id]);
});

test('an import before the series has bars asks for its profiles on the first bar change', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const target = createSession();
  target.fakeHost.barSeries.bars = [];
  target.tool.drawings.importRecords(source.tool.drawings.exportRecords());
  expect(target.market.requests).toEqual([]);
  target.fakeHost.barSeries.bars = oneMinuteBars();
  target.tool.barsChanged();
  expect(target.market.requests).toHaveLength(1);
});
