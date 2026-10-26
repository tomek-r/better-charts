import { test, expect } from '@playwright/test';
import { ChartDrawingCollection } from '../src/features/chart/engine/drawings/chartDrawingCollection';
import type { ChartDrawingPoint, ChartToolDrawingRecord } from '../src/features/chart/engine/drawings/drawingRecord';
import type { ChartDrawingPointRule } from '../src/features/chart/engine/drawings/toolDrawings';
import type { ToolInputDefinition } from '../src/features/chart/engine/drawings/toolInputs';
import { FakeDrawingShape } from './helpers/fakeDrawingShape';

/**
 * The one place every tool's drawings share: the paint order, the selection, the lock, visibility and
 * settings of each drawing, and the records the app stores. A fake drawing stands in for a tool's own
 * ones, so the rules the collection owns are the only thing under test. Pure Node, no browser.
 */

const TIME_POINT: ChartDrawingPoint = { timeMs: 1_000, price: null };
const PRICE_POINT: ChartDrawingPoint = { timeMs: null, price: '1.0850' };
const BOTH_POINT: ChartDrawingPoint = { timeMs: 1_000, price: '1.0850' };

const PERIOD_INPUT = {
  kind: 'int',
  id: 'period',
  title: 'Period',
  defaultValue: 20,
  minValue: 1,
  maxValue: 200,
} satisfies ToolInputDefinition;

/** Two time-only anchors: the rule of a tool whose drawings span one window. */
const TWO_TIME_POINTS: ChartDrawingPointRule = { min: 2, max: 2, anchor: 'time' };

type Collection = ChartDrawingCollection<FakeDrawingShape>;

interface Harness {
  collection: Collection;
  /** How many repaints the collection asked for. */
  repaints(): number;
}

/** The id of the entry the collection paints as selected, null when none is. */
function selectedId(collection: Collection): string | null {
  return collection.entries().find((entry) => entry.selected)?.id ?? null;
}

function buildCollection(
  points: ChartDrawingPointRule = TWO_TIME_POINTS,
  inputs: readonly ToolInputDefinition[] = [PERIOD_INPUT],
): Harness {
  let repaintCount = 0;
  const collection = new ChartDrawingCollection<FakeDrawingShape>(
    { inputs, points },
    { restore: (stored) => new FakeDrawingShape(0, stored) },
    () => {
      repaintCount += 1;
    },
  );
  return { collection, repaints: () => repaintCount };
}

/** A record as the app stores it, so an import test changes only the part it is about. */
function recordOf(points: ChartDrawingPoint[], patch: Partial<ChartToolDrawingRecord> = {}): ChartToolDrawingRecord {
  return { id: 'stored-1', locked: false, visible: true, inputs: {}, points, ...patch };
}

test('an added drawing exports its id, flags, settings and points, and hears that it is shown', () => {
  const { collection } = buildCollection();
  const drawing = new FakeDrawingShape(10, [TIME_POINT, BOTH_POINT]);
  const id = collection.add(drawing, { locked: true, visible: true, inputs: { period: 30 } });

  expect(collection.exportRecords()).toEqual([
    { id, locked: true, visible: true, inputs: { period: 30 }, points: [TIME_POINT, BOTH_POINT] },
  ]);
  expect(collection.isLocked(id)).toBe(true);
  expect(collection.isVisible(id)).toBe(true);
  expect(drawing.events).toEqual(['shown']);
});

test('a drawing added without state starts unlocked, visible, with the tool default settings', () => {
  const { collection } = buildCollection();
  const id = collection.add(new FakeDrawingShape(10, [TIME_POINT, TIME_POINT]));
  expect(collection.exportRecords()).toEqual([
    { id, locked: false, visible: true, inputs: { period: 20 }, points: [TIME_POINT, TIME_POINT] },
  ]);
});

/** One rule kind: the anchor lists it keeps, and the ones it drops. */
interface RuleCase {
  readonly name: string;
  readonly rule: ChartDrawingPointRule;
  readonly kept: ChartDrawingPoint[][];
  readonly dropped: ChartDrawingPoint[][];
}

const RULE_CASES: readonly RuleCase[] = [
  {
    name: 'a time-only rule',
    rule: { min: 2, max: 2, anchor: 'time' },
    kept: [
      [TIME_POINT, TIME_POINT],
      [TIME_POINT, BOTH_POINT],
    ],
    dropped: [[TIME_POINT], [TIME_POINT, TIME_POINT, TIME_POINT], [TIME_POINT, PRICE_POINT]],
  },
  {
    name: 'a price-only rule',
    rule: { min: 1, max: 2, anchor: 'price' },
    kept: [[PRICE_POINT], [PRICE_POINT, BOTH_POINT]],
    dropped: [[], [TIME_POINT], [PRICE_POINT, PRICE_POINT, PRICE_POINT]],
  },
  {
    name: 'a time-and-price rule',
    rule: { min: 2, max: 2, anchor: 'timePrice' },
    kept: [[BOTH_POINT, BOTH_POINT]],
    dropped: [[BOTH_POINT], [TIME_POINT, BOTH_POINT], [PRICE_POINT, BOTH_POINT]],
  },
];

for (const { name, rule, kept, dropped } of RULE_CASES) {
  test(`an import under ${name} keeps the anchors it asks for and drops the rest`, () => {
    const { collection } = buildCollection(rule);
    collection.importRecords([
      ...kept.map((points, index) => recordOf(points, { id: `kept-${index}` })),
      ...dropped.map((points, index) => recordOf(points, { id: `dropped-${index}` })),
    ]);

    expect(collection.exportRecords().map(({ id, points }) => ({ id, points }))).toEqual(
      kept.map((points, index) => ({ id: `kept-${index}`, points })),
    );
  });
}

test('an import resolves the settings against the definitions, dropping unknown keys and bad values', () => {
  const { collection } = buildCollection();
  collection.importRecords([
    recordOf([TIME_POINT, TIME_POINT], { id: 'stored', inputs: { period: 55, vanished: 5 } }),
    recordOf([TIME_POINT, TIME_POINT], { id: 'invalid', inputs: { period: 'old' } }),
  ]);

  expect(collection.exportRecords().map(({ id, inputs }) => ({ id, inputs }))).toEqual([
    { id: 'stored', inputs: { period: 55 } },
    { id: 'invalid', inputs: { period: 20 } },
  ]);
});

test('an import replaces the drawings the collection already held, disposing of them', () => {
  const { collection } = buildCollection();
  const previous = new FakeDrawingShape(0, [TIME_POINT, TIME_POINT]);
  collection.add(previous);

  collection.importRecords([recordOf([TIME_POINT, TIME_POINT])]);

  expect(collection.exportRecords().map(({ id }) => id)).toEqual(['stored-1']);
  expect(previous.events).toEqual(['shown', 'disposed']);
});

test('hits answers only for a visible drawing the point is on', () => {
  const { collection } = buildCollection();
  const lower = collection.add(new FakeDrawingShape(10));
  const upper = collection.add(new FakeDrawingShape(10));

  expect(collection.hits(upper, 10, 0)).toBe(true);
  expect(collection.hits(upper, 20, 0)).toBe(false);
  expect(collection.hits('missing', 10, 0)).toBe(false);
  expect(collection.isLocked(lower)).toBe(false);
});

test('a hidden drawing is never hit', () => {
  const { collection } = buildCollection();
  const below = collection.add(new FakeDrawingShape(10));
  const above = collection.add(new FakeDrawingShape(10));

  collection.setVisible(above, false);

  expect(collection.hits(above, 10, 0)).toBe(false);
  expect(collection.hits(below, 10, 0)).toBe(true);
  expect(collection.isVisible(above)).toBe(false);
});

test('the drawing ids are the paint order, bottom to top', () => {
  const { collection } = buildCollection();
  const first = collection.add(new FakeDrawingShape(10));
  const second = collection.add(new FakeDrawingShape(11));

  expect(collection.drawingIds()).toEqual([first, second]);
});

test('arranging reorders the drawings, ignores unknown ids and keeps the unlisted ones on top', () => {
  const { collection, repaints } = buildCollection();
  const first = collection.add(new FakeDrawingShape(10));
  const second = collection.add(new FakeDrawingShape(11));
  const third = collection.add(new FakeDrawingShape(12));
  const repaintsBefore = repaints();

  collection.arrange([third, 'missing', first]);

  expect(collection.drawingIds()).toEqual([third, first, second]);
  expect(collection.exportRecords().map(({ id }) => id)).toEqual([third, first, second]);
  expect(repaints()).toBe(repaintsBefore + 1);
});

test('hiding and showing tells the drawing once per real change', () => {
  const { collection } = buildCollection();
  const drawing = new FakeDrawingShape(10);
  const id = collection.add(drawing);

  collection.setVisible(id, true);
  collection.setVisible(id, false);
  collection.setVisible(id, false);
  collection.setVisible(id, true);

  expect(drawing.events).toEqual(['shown', 'hidden', 'shown']);
  expect(collection.setVisible('missing', false)).toBe(false);
});

test('hiding the selected drawing drops the selection with it', () => {
  const { collection } = buildCollection();
  const id = collection.add(new FakeDrawingShape(10));
  collection.select(id);
  expect(selectedId(collection)).toBe(id);

  collection.setVisible(id, false);
  expect(selectedId(collection)).toBeNull();
});

test('deleting a drawing disposes of it, drops it from the selection and reports that it went', () => {
  const { collection } = buildCollection();
  const drawing = new FakeDrawingShape(10);
  const id = collection.add(drawing);
  collection.select(id);

  expect(collection.delete(id)).toBe(true);
  expect(collection.exportRecords()).toEqual([]);
  expect(drawing.events).toEqual(['shown', 'disposed']);
  expect(selectedId(collection)).toBeNull();
  expect(collection.delete(id)).toBe(false);
});

test('clearing disposes of every drawing and of the selection', () => {
  const { collection } = buildCollection();
  const first = new FakeDrawingShape(10);
  const second = new FakeDrawingShape(11);
  collection.add(first);
  collection.add(second);
  collection.select(collection.exportRecords()[1].id);

  collection.clear();

  expect(first.events).toEqual(['shown', 'disposed']);
  expect(second.events).toEqual(['shown', 'disposed']);
  expect(collection.exportRecords()).toEqual([]);
  expect(selectedId(collection)).toBeNull();
});

test('selecting marks exactly one entry, and selecting it again repaints nothing more', () => {
  const { collection, repaints } = buildCollection();
  const first = collection.add(new FakeDrawingShape(10));
  const second = collection.add(new FakeDrawingShape(11));

  collection.select(second);
  expect(collection.entries().map(({ id, selected }) => ({ id, selected }))).toEqual([
    { id: first, selected: false },
    { id: second, selected: true },
  ]);
  const repaintsAfterSelect = repaints();
  collection.select(second);
  expect(repaints()).toBe(repaintsAfterSelect);

  collection.select(null);
  expect(selectedId(collection)).toBeNull();
});

test('a missing id changes no drawing, and selecting it clears the selection', () => {
  const { collection } = buildCollection();
  const id = collection.add(new FakeDrawingShape(10));
  collection.select(id);

  expect(collection.setInputs('missing', { period: 40 })).toBe(false);
  expect(collection.setLocked('missing', true)).toBe(false);
  collection.select('missing');

  expect(collection.exportRecords()[0].inputs).toEqual({ period: 20 });
  expect(collection.isLocked(id)).toBe(false);
  expect(selectedId(collection)).toBeNull();
});
