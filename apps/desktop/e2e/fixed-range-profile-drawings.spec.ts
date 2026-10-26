import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort, profileResultFor } from './helpers/fakeMarketDataPort';
import { createFakeToolHost, oneMinuteBars, SLOT_WIDTH_PX, FAKE_SYMBOL } from './helpers/fakeToolHost';
import { FixedRangeProfileTool } from '../src/features/tools/fixedRangeProfile/tool';
import { readFixedRangeProfilePoints } from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfilePoints';

/**
 * Many independent drawings of one tool: two placements no longer replace each other, each drawing has
 * its own id, lock, settings and request, and a press, a delete or a drag addresses exactly one of them.
 *
 * The fake series is ten one-minute bars from 1_000 s, so a click at slot * SLOT_WIDTH_PX lands on that
 * bar and a two-click placement commits the bar window it spans.
 */

const PANE_Y = 200;
/** Slots 2..6: the window [1_120_000, 1_420_000) ms, handles at x 20 and 60. */
const FIRST_CLICKS = [25, 65];
/** Slots 8..9: the window [1_480_000, 1_600_000) ms, handles at x 80 and 90. */
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
  expect(drawings[0].range).toEqual({ fromMs: 1_120_000, endMs: 1_420_000 });
  expect(drawings[1].range).toEqual({ fromMs: 1_480_000, endMs: 1_600_000 });
});

test('the second drawing asks for its profile only once the first one answered', () => {
  const session = createSession();
  session.place(FIRST_CLICKS);
  session.place(SECOND_CLICKS);
  expect(session.market.requests).toHaveLength(1);
  answerInFlight(session);
  expect(session.market.requests.map((request) => request.fromMs)).toEqual([1_120_000, 1_480_000]);
});

test('drawingAt finds the topmost drawing over its band and nothing outside', () => {
  const { tool, place } = createSession();
  place(FIRST_CLICKS);
  place(SECOND_CLICKS);
  const [first, second] = tool.testApi().drawings();
  expect(tool.drawingAt(FIRST_FROM_X + 5, PANE_Y)).toBe(first.id);
  expect(tool.drawingAt(SECOND_FROM_X + 5, PANE_Y)).toBe(second.id);
  expect(tool.drawingAt(GAP_X, PANE_Y)).toBeNull();
  expect(tool.drawingAt(FIRST_FROM_X + 5, 500)).toBeNull();
  // A later drawing over the same window is on top of the earlier one.
  place(FIRST_CLICKS);
  expect(tool.drawingAt(FIRST_FROM_X + 5, PANE_Y)).toBe(tool.testApi().drawings()[2].id);
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
  expect(session.tool.setDrawingLocked(first.id, true)).toBe(true);
  expect(session.tool.pointerDown(FIRST_FROM_X, PANE_Y, 'editExistingDrawing')).toBe(false);
  expect(session.tool.testApi().drawings()[0].range).toEqual(first.range);
  expect(session.tool.pointerDown(SECOND_FROM_X, PANE_Y, 'editExistingDrawing')).toBe(true);
  session.tool.pointerMove(SECOND_FROM_X + SLOT_WIDTH_PX);
  session.tool.pointerUp('released');
  expect(session.fakeHost.changeCount()).toBe(1);
  expect(session.tool.testApi().drawings()[1].range).toEqual({ fromMs: 1_540_000, endMs: 1_600_000 });
  expect(second.locked).toBe(false);
});

test('deleteDrawing removes one drawing and cancels only its own request', () => {
  const { session, first, second } = sessionWithTwoDrawings();
  expect(session.tool.deleteDrawing(first.id)).toBe(true);
  expect(
    session.tool
      .testApi()
      .drawings()
      .map((drawing) => drawing.id),
  ).toEqual([second.id]);
  expect(session.market.cancelCount()).toBe(0);
  expect(session.tool.deleteDrawing(second.id)).toBe(true);
  expect(session.tool.testApi().drawings()).toEqual([]);
  expect(session.market.cancelCount()).toBe(1);
  expect(session.tool.deleteDrawing(second.id)).toBe(false);
});

test('an export imports into a fresh tool that asks for each profile without reporting anything', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  source.place(SECOND_CLICKS);
  const records = source.tool.exportDrawings();
  expect(records).toHaveLength(2);
  const target = createSession();
  target.tool.importDrawings(records);
  expect(target.tool.exportDrawings()).toEqual(records);
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
  const [record] = source.tool.exportDrawings();
  expect(record.visible).toBe(true);
  expect(record.points).toEqual([
    { timeMs: 1_120_000, price: null },
    { timeMs: 1_420_000, price: null },
  ]);

  const target = createSession();
  target.tool.importDrawings([{ ...record, visible: false }]);

  expect(target.tool.exportDrawings()).toEqual([{ ...record, visible: false }]);
});

test('an import drops a record whose points do not name a window', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const [record] = source.tool.exportDrawings();
  const target = createSession();
  const [start, end] = record.points;
  target.tool.importDrawings([
    record,
    { ...record, id: 'reversed', points: [end, start] },
    { ...record, id: 'priced', points: [{ ...start, price: '1.0850' }, end] },
  ]);

  expect(
    target.tool
      .testApi()
      .drawings()
      .map((drawing) => drawing.id),
  ).toEqual([record.id]);
});

test('an import before the series has bars asks for its profiles on the first bar change', () => {
  const source = createSession();
  source.place(FIRST_CLICKS);
  const target = createSession();
  target.fakeHost.barSeries.bars = [];
  target.tool.importDrawings(source.tool.exportDrawings());
  expect(target.market.requests).toEqual([]);
  target.fakeHost.barSeries.bars = oneMinuteBars();
  target.tool.barsChanged();
  expect(target.market.requests).toHaveLength(1);
});
