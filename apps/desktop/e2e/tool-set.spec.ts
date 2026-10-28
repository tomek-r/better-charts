import { test, expect } from '@playwright/test';
import { ChartToolSet } from '../src/features/chart/engine/tools/toolSet';
import { ChartDrawingCollection } from '../src/features/chart/engine/drawings/chartDrawingCollection';
import type {
  ChartDrawingPoint,
  ChartDrawingRecord,
  ChartDrawingSelection,
} from '../src/features/chart/engine/drawings/drawingRecord';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../src/features/chart/engine/drawings/timeframeVisibility';
import type { ChartDrawingPointRule } from '../src/features/chart/engine/drawings/toolDrawings';
import type { ToolInputDefinition } from '../src/features/chart/engine/drawings/toolInputs';
import type {
  ChartDrawingPaintTarget,
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolHostBase,
} from '../src/features/chart/engine/tools/toolContract';
import { ArrowTool } from '../src/features/tools/arrow/tool';
import { FakeDrawingShape } from './helpers/fakeDrawingShape';

/**
 * Routing and lifecycle rules of the engine's tool set, with fake tools that log every call they
 * receive and keep their drawings in the engine's own drawing collection. The set is DOM-free, so no
 * browser is needed.
 */

/** One anchor point, which the fake tools keep unchanged: the set routes them, it never reads them. */
const ORIGIN_POINT: ChartDrawingPoint = { timeMs: 0, price: null };

/** The settings every fake tool's drawings carry; the set never resolves them, the collection does. */
const FAKE_INPUTS: readonly ToolInputDefinition[] = [{ kind: 'int', id: 'period', title: 'Period', defaultValue: 20 }];
const FAKE_POINTS: ChartDrawingPointRule = { min: 1, max: 4, anchor: 'time' };
const FAKE_DRAWING_RULES = { inputs: FAKE_INPUTS, points: FAKE_POINTS };

/** How often the set reported something worth saving. */
interface ChangeReports {
  drawingsChanged: number;
}

type FakeDrawings = ChartDrawingCollection<FakeDrawingShape>;

interface Harness {
  tools: ChartToolSet;
  /** Every call the fake tools received, as `toolId:call`, in order. */
  log: string[];
  cursors: Array<string | undefined>;
  /** Every selection the set reported, in order; a null entry is a cleared selection. */
  selections: Array<ChartDrawingSelection | null>;
  reports: ChangeReports;
  /** Ids of the tools that report a gesture in progress. */
  gesturing: Set<string>;
  /** Extra `draw` behavior per tool id, to prove draw isolation. */
  drawActions: Map<string, (context: CanvasRenderingContext2D) => void>;
  /** Each fake tool's drawings, keyed by tool id. */
  drawings: Map<string, FakeDrawings>;
  /** The timeframe the chart reports to the set; a test assigns it before the bars change. */
  barSeries: { timeframe: string };
}

/** The timeframe every harness starts on. */
const START_TIMEFRAME = 'M5';

/** The only part of the owner's host the set reads: the bar series and its timeframe. */
function hostOn(barSeries: { timeframe: string }): ChartToolHostBase {
  return { barSeries } as unknown as ChartToolHostBase;
}

/** The tool ids a harness builds tools for, and the ones that place drawings. */
interface ToolKinds {
  readonly toolIds?: readonly string[];
  readonly placementToolIds?: readonly string[];
}

/** The selection one drawing is expected to report, with the flags the test watches. */
function selectionOf(toolId: string, drawingId: string, locked: boolean, visible: boolean): ChartDrawingSelection {
  return { toolId, drawingId, locked, visible };
}

/**
 * The target of one drawing's paint pass: the fakes read the context alone, so the viewport and the
 * bitmap stay empty here.
 */
function drawingTarget(context: CanvasRenderingContext2D): ChartDrawingPaintTarget {
  return { context, viewport: {} as ChartDrawTarget['viewport'], bitmap: {} as ChartDrawTarget['bitmap'] };
}

/** The target of one pane layer pass, which every drawing and every tool's `draw` receives. */
function paneTarget(context: CanvasRenderingContext2D): ChartDrawTarget {
  return { ...drawingTarget(context), layer: { surface: 'pane', depth: 'belowTradingOverlays' } };
}

/** One stored record of a fake tool, on the side of the bars the case is about. */
function storedRecord(drawing: { readonly id: string; readonly belowBars: boolean }): ChartDrawingRecord {
  return {
    ...drawing,
    toolId: 'a',
    locked: false,
    visible: true,
    timeframeVisibility: DEFAULT_TIMEFRAME_VISIBILITY,
    inputs: {},
    points: [ORIGIN_POINT],
  };
}

/** Every paint call the fakes received, in order, without the lifecycle calls around them. */
function paintLog({ log }: Harness): string[] {
  return log.filter((call) => call.includes(':draw'));
}

/** The id of the drawing a fake tool paints as selected, null when none of its drawings is. */
function selectedInTool(harness: Harness, toolId: string): string | null {
  return (
    harness.drawings
      .get(toolId)
      ?.entries()
      .find((entry) => entry.selected)?.id ?? null
  );
}

function buildToolSet({ toolIds = ['a', 'b', 'c'], placementToolIds = [] }: ToolKinds = {}): Harness {
  const log: string[] = [];
  const cursors: Array<string | undefined> = [];
  const selections: Array<ChartDrawingSelection | null> = [];
  const reports: ChangeReports = { drawingsChanged: 0 };
  const gesturing = new Set<string>();
  const drawActions = new Map<string, (context: CanvasRenderingContext2D) => void>();
  const drawings = new Map<string, FakeDrawings>();
  const barSeries = { timeframe: START_TIMEFRAME };
  const definitions: ChartToolDefinition[] = toolIds.map((id) => {
    const shapes = new ChartDrawingCollection<FakeDrawingShape>(
      FAKE_DRAWING_RULES,
      { restore: (points) => new FakeDrawingShape(0, points) },
      () => undefined,
    );
    const placesDrawings = placementToolIds.includes(id);
    drawings.set(id, shapes);
    return {
      id,
      cursor: `cursor-${id}`,
      placesDrawings,
      ...FAKE_DRAWING_RULES,
      toolClass: class implements ChartTool {
        private pressingAtX: number | null = null;

        constructor(private readonly host: ChartToolHost) {}

        readonly drawings = shapes;

        hasGesture = () => gesturing.has(id);
        cancelGesture = () => log.push(`${id}:cancelGesture`);
        activate = () => log.push(`${id}:activate`);
        deactivate = () => log.push(`${id}:deactivate`);
        pointerHover = (x: number, y: number) => log.push(`${id}:pointerHover(${x},${y})`);
        pointerLeave = () => log.push(`${id}:pointerLeave`);
        draw = ({ context }: ChartDrawTarget) => {
          log.push(`${id}:draw`);
          drawActions.get(id)?.(context);
        };
        drawDrawing = ({ context }: ChartDrawingPaintTarget, drawingId: string) => {
          log.push(`${id}:drawDrawing:${drawingId}`);
          drawActions.get(id)?.(context);
        };
        reset = () => this.drawings.clear();

        pointerDown = (x: number) => {
          if (!placesDrawings) {
            return false;
          }
          this.pressingAtX = x;
          return true;
        };

        pointerUp = (outcome: ChartPointerUpOutcome) => {
          const x = this.pressingAtX;
          this.pressingAtX = null;
          if (x === null) {
            return false;
          }
          if (outcome === 'released') {
            this.host.drawingPlaced(this.drawings.add(new FakeDrawingShape(x, [ORIGIN_POINT])));
          }
          return true;
        };
      },
    };
  });
  const tools = new ChartToolSet(definitions, 'a', hostOn(barSeries), {
    cursorChanged: (cursor) => cursors.push(cursor),
    selectionChanged: (selection) => selections.push(selection),
    drawingsChanged: () => {
      reports.drawingsChanged += 1;
    },
  });
  tools.activateDefaultTool();
  log.length = 0;
  cursors.length = 0;
  return { tools, log, cursors, selections, reports, gesturing, drawActions, drawings, barSeries };
}

/** Seeds one committed, unlocked drawing on a fake tool, hittable at pane x, and answers its id. */
function seedDrawing(harness: Harness, toolId: string, x: number): string {
  const shapes = harness.drawings.get(toolId);
  if (shapes === undefined) {
    throw new Error(`No fake tool "${toolId}"`);
  }
  const drawingId = shapes.add(new FakeDrawingShape(x, [ORIGIN_POINT]));
  // Reading the order heals it, as the next paint would, so a drawing seeded later sits on top.
  harness.tools.drawingStack();
  return drawingId;
}

/**
 * Seeds one drawing on tool "a" at pane x 5, presses it so it becomes the selection, and clears the
 * recorded selections and change reports so the test sees only what happens next. Answers its id.
 */
function seedSelectedDrawing(harness: Harness): string {
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.pointerDown(5, 1);
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  return drawingId;
}

/** A harness with a selected drawing of tool "a" and one more drawing of tool "b" that is not selected. */
function harnessWithUnselectedDrawing(): { harness: Harness; selected: string; other: string } {
  const harness = buildToolSet();
  const selected = seedSelectedDrawing(harness);
  const other = seedDrawing(harness, 'b', 20);
  return { harness, selected, other };
}

test('selecting a tool cancels every gesture in progress before the switch', () => {
  const { tools, log, gesturing } = buildToolSet();
  gesturing.add('b');
  tools.selectTool('c');
  expect(log).toEqual(['b:cancelGesture', 'a:pointerLeave', 'a:deactivate', 'c:activate']);
});

test('selecting the active tool again with no gesture does nothing', () => {
  const { tools, log, cursors } = buildToolSet();
  tools.selectTool('a');
  expect(log).toEqual([]);
  expect(cursors).toEqual([]);
});

test('selecting the active tool again while it has a gesture cancels it and re-activates the tool', () => {
  const { tools, log, gesturing } = buildToolSet();
  gesturing.add('a');
  tools.selectTool('a');
  expect(log).toEqual(['a:cancelGesture', 'a:pointerLeave', 'a:deactivate', 'a:activate']);
});

test('a switch runs pointerLeave, deactivate, activate, then replays the resting pointer to the new tool', () => {
  const { tools, log, cursors } = buildToolSet();
  tools.pointerHover(3, 4);
  log.length = 0;
  tools.selectTool('b');
  expect(log).toEqual(['a:pointerLeave', 'a:deactivate', 'b:activate', 'b:pointerHover(3,4)']);
  expect(cursors).toEqual(['cursor-b']);
});

test('a switch does not replay a pointer that already left the pane', () => {
  const { tools, log } = buildToolSet();
  tools.pointerHover(3, 4);
  tools.pointerLeave();
  log.length = 0;
  tools.selectTool('b');
  expect(log).toEqual(['a:pointerLeave', 'a:deactivate', 'b:activate']);
});

test('returning to the default tool leaves gestures running', () => {
  const { tools, log, gesturing } = buildToolSet();
  tools.selectTool('b');
  gesturing.add('b');
  log.length = 0;
  tools.returnToDefaultTool();
  expect(log).toEqual(['b:pointerLeave', 'b:deactivate', 'a:activate']);
});

test('selecting an unknown tool is rejected', () => {
  const { tools } = buildToolSet();
  expect(() => tools.selectTool('missing')).toThrow('Unknown chart tool "missing"');
});

test('a press picks the drawing the order paints last under the pointer', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 10);
  const topmost = seedDrawing(harness, 'c', 10);
  harness.tools.pointerDown(10, 5);
  const selection = { toolId: 'c', drawingId: topmost, locked: false, visible: true };
  expect(harness.tools.selectedDrawing()).toEqual(selection);
  expect(harness.selections).toEqual([selection]);
  expect(selectedInTool(harness, 'c')).toBe(topmost);
});

test('a press that hits no drawing clears the selection and unhighlights the old one', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'b', 5);
  harness.tools.pointerDown(5, 1);
  harness.tools.pointerDown(50, 1);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(selectedInTool(harness, 'b')).toBeNull();
  expect(harness.selections).toEqual([{ toolId: 'b', drawingId, locked: false, visible: true }, null]);
});

test('a press with a placement tool active leaves the selection alone', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'], placementToolIds: ['b'] });
  seedDrawing(harness, 'a', 10);
  harness.tools.selectTool('b');
  harness.tools.pointerDown(20, 0);
  harness.tools.pointerUp('released');
  const placed = harness.tools.selectedDrawing();
  expect(placed).toMatchObject({ toolId: 'b', locked: false, visible: true });
  harness.tools.pointerDown(10, 0);
  expect(harness.tools.selectedDrawing()).toEqual(placed);
});

test('selecting a placement tool clears the selection', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'], placementToolIds: ['b'] });
  seedDrawing(harness, 'a', 10);
  harness.tools.pointerDown(10, 0);
  expect(harness.tools.selectedDrawing()).not.toBeNull();
  harness.tools.selectTool('b');
  expect(harness.tools.selectedDrawing()).toBeNull();
});

test('a newly placed drawing becomes selected and the change is reported once', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'], placementToolIds: ['b'] });
  harness.tools.selectTool('b');
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  harness.tools.pointerDown(20, 0);
  harness.tools.pointerUp('released');
  expect(harness.tools.selectedDrawing()).toEqual({
    toolId: 'b',
    drawingId: expect.any(String),
    locked: false,
    visible: true,
  });
  expect(harness.selections).toHaveLength(1);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('deleting a locked drawing of another tool by id keeps the selection and reports the change once', () => {
  const { harness, selected, other } = harnessWithUnselectedDrawing();
  harness.tools.setDrawingLocked('b', other, true);
  harness.reports.drawingsChanged = 0;

  expect(harness.tools.deleteDrawing('b', other)).toBe(true);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', selected, false, true));
  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('b')?.exportRecords()).toEqual([]);
});

test('deleting the selected drawing by id drops the selection', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);

  expect(harness.tools.deleteDrawing('a', drawingId)).toBe(true);

  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.selections).toEqual([null]);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('deleting an unknown drawing or an unknown tool reports false and reports nothing', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'a', 5);

  expect(harness.tools.deleteDrawing('a', 'missing')).toBe(false);
  expect(harness.tools.deleteDrawing('missing', drawingId)).toBe(false);

  expect(harness.reports.drawingsChanged).toBe(0);
  expect(
    harness.drawings
      .get('a')
      ?.exportRecords()
      .map(({ id }) => id),
  ).toEqual([drawingId]);
});

test('selecting a drawing of another tool by id selects and highlights it', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'b', 20);

  harness.tools.selectDrawing('b', drawingId);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('b', drawingId, false, true));
  expect(harness.selections).toEqual([selectionOf('b', drawingId, false, true)]);
  expect(selectedInTool(harness, 'b')).toBe(drawingId);
});

test('a hidden drawing can be selected by id and reports itself as hidden', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingVisible('a', drawingId, false);
  harness.selections.length = 0;

  harness.tools.selectDrawing('a', drawingId);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, false, false));
  expect(harness.selections).toEqual([selectionOf('a', drawingId, false, false)]);
});

test('selecting an unknown drawing or an unknown tool changes nothing', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);

  harness.tools.selectDrawing('a', 'missing');
  harness.tools.selectDrawing('missing', drawingId);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, false, true));
  expect(harness.selections).toEqual([]);
  expect(selectedInTool(harness, 'a')).toBe(drawingId);
});

test('locking the selected drawing by id updates the selection and reports the change once', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);

  harness.tools.setDrawingLocked('a', drawingId, true);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, true, true));
  expect(harness.selections).toEqual([selectionOf('a', drawingId, true, true)]);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('locking a drawing that is not selected leaves the selection as it was', () => {
  const { harness, selected, other } = harnessWithUnselectedDrawing();

  harness.tools.setDrawingLocked('b', other, true);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', selected, false, true));
  expect(harness.selections).toEqual([]);
  expect(harness.drawings.get('b')?.exportRecords()[0]?.locked).toBe(true);
});

test('locking or showing through an unknown tool or drawing changes nothing', () => {
  const harness = buildToolSet();

  harness.tools.setDrawingLocked('missing', 'missing', true);
  harness.tools.setDrawingLocked('a', 'missing', true);
  harness.tools.setDrawingVisible('missing', 'missing', true);

  expect(harness.reports.drawingsChanged).toBe(0);
});

test('hiding the selected drawing clears the selection and reports the change once', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);

  harness.tools.setDrawingVisible('a', drawingId, false);

  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.selections).toEqual([null]);
  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('a')?.exportRecords()[0]?.visible).toBe(false);
});

test('a hidden drawing is skipped by the hit test, so the drawing below it is picked', () => {
  const harness = buildToolSet();
  const below = seedDrawing(harness, 'a', 5);
  const hidden = seedDrawing(harness, 'a', 5);

  harness.tools.setDrawingVisible('a', hidden, false);
  harness.tools.pointerDown(5, 1);

  expect(harness.tools.selectedDrawing()).toEqual({ toolId: 'a', drawingId: below, locked: false, visible: true });
});

test('hiding a drawing that is not selected keeps the selection', () => {
  const harness = buildToolSet();
  const selected = seedDrawing(harness, 'a', 5);
  const other = seedDrawing(harness, 'b', 20);
  harness.tools.pointerDown(5, 1);

  harness.tools.setDrawingVisible('b', other, false);

  expect(harness.tools.selectedDrawing()).toEqual({
    toolId: 'a',
    drawingId: selected,
    locked: false,
    visible: true,
  });
});

test('showing the selected hidden drawing updates the selection to visible', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingVisible('a', drawingId, false);
  harness.tools.selectDrawing('a', drawingId);
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;

  harness.tools.setDrawingVisible('a', drawingId, true);

  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, false, true));
  expect(harness.selections).toEqual([selectionOf('a', drawingId, false, true)]);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('new settings on a drawing are reported only when the tool accepts them', () => {
  const harness = buildToolSet();
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingInputs('a', drawingId, { period: 30 });
  expect(harness.reports.drawingsChanged).toBe(1);
  harness.tools.setDrawingInputs('a', 'missing', { period: 50 });
  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('a')?.exportRecords()[0]?.inputs).toEqual({ period: 30 });
});

test('new anchors on the selected drawing are reported once and keep it selected', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);
  const movedPoints = [{ timeMs: 5, price: null }];

  expect(harness.tools.setDrawingPoints('a', drawingId, movedPoints)).toBe(true);

  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('a')?.exportRecords()[0]?.points).toEqual(movedPoints);
  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, false, true));
  expect(selectedInTool(harness, 'a')).toBe(drawingId);
});

test('anchors the tool refuses, or for an unknown drawing or tool, report nothing', () => {
  const harness = buildToolSet();
  const drawingId = seedSelectedDrawing(harness);

  expect(harness.tools.setDrawingPoints('a', drawingId, [])).toBe(false);
  expect(harness.tools.setDrawingPoints('a', 'missing', [ORIGIN_POINT])).toBe(false);
  expect(harness.tools.setDrawingPoints('missing', drawingId, [ORIGIN_POINT])).toBe(false);

  expect(harness.reports.drawingsChanged).toBe(0);
  expect(harness.drawings.get('a')?.exportRecords()[0]?.points).toEqual([ORIGIN_POINT]);
});

test('exported drawings are stamped with their tool, bottom of the order first', () => {
  const harness = buildToolSet({ toolIds: ['b', 'a'] });
  const first = seedDrawing(harness, 'b', 1);
  const second = seedDrawing(harness, 'a', 2);
  const stamped = harness.tools.exportDrawings().map(({ toolId, id }) => `${toolId}:${id}`);
  expect(stamped).toEqual([`b:${first}`, `a:${second}`]);
});

test('importing hands each tool only its own records, drops unknown tools and reports nothing', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  seedDrawing(harness, 'a', 5);
  harness.tools.pointerDown(5, 1);
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  const records: ChartDrawingRecord[] = [
    { ...storedRecord({ id: 'a-1', belowBars: false }), toolId: 'a' },
    {
      ...storedRecord({ id: 'b-1', belowBars: false }),
      toolId: 'b',
      locked: true,
      visible: false,
      inputs: { period: 20 },
    },
    { ...storedRecord({ id: 'c-1', belowBars: false }), toolId: 'c' },
  ];
  harness.tools.replaceDrawings(records);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.selections).toEqual([null]);
  expect(
    harness.drawings
      .get('a')
      ?.exportRecords()
      .map(({ id }) => id),
  ).toEqual(['a-1']);
  expect(
    harness.drawings
      .get('b')
      ?.exportRecords()
      .map(({ id }) => id),
  ).toEqual(['b-1']);
  expect(harness.reports.drawingsChanged).toBe(0);
});

test('an imported record keeps its id, flags and settings', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const record: ChartDrawingRecord = {
    ...storedRecord({ id: 'a-1', belowBars: false }),
    locked: true,
    visible: false,
    inputs: { period: 55 },
  };

  harness.tools.replaceDrawings([record]);

  expect(harness.tools.exportDrawings()).toEqual([record]);
});

test('the drawings of every tool paint in one order, bottom to top', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  const below = seedDrawing(harness, 'b', 10);
  const above = seedDrawing(harness, 'a', 20);
  harness.log.length = 0;

  harness.tools.draw(paneTarget(createStateContext()));

  // The drawing of "b" paints first although "a" is registered first: place order decides.
  expect(paintLog(harness)).toEqual([`b:drawDrawing:${below}`, `a:drawDrawing:${above}`, 'a:draw', 'b:draw']);
});

test('a drawing below the bars paints in the below-bars pass only', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  harness.tools.replaceDrawings([
    storedRecord({ id: 'under', belowBars: true }),
    storedRecord({ id: 'over', belowBars: false }),
  ]);
  harness.log.length = 0;

  harness.tools.draw(paneTarget(createStateContext()));
  expect(paintLog(harness)).toEqual(['a:drawDrawing:over', 'a:draw']);

  harness.log.length = 0;
  harness.tools.drawBelowBars(drawingTarget(createStateContext()));
  expect(paintLog(harness)).toEqual(['a:drawDrawing:under']);
});

test('a hidden drawing is painted in neither pass', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 10);
  harness.tools.setDrawingVisible('a', drawingId, false);
  harness.log.length = 0;

  harness.tools.draw(paneTarget(createStateContext()));
  harness.tools.drawBelowBars(drawingTarget(createStateContext()));

  expect(paintLog(harness)).toEqual(['a:draw']);
});

/** Minutes 1 to 3 only: the harness starts on M5, which this setting hides, and M1 shows. */
const SHOWN_ON_SHORT_MINUTES_ONLY: DrawingTimeframeVisibility = {
  ...DEFAULT_TIMEFRAME_VISIBILITY,
  minutes: { shown: true, from: 1, to: 3 },
};

test('a drawing the current timeframe hides is painted in neither pass and is not hit', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingTimeframeVisibility('a', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);
  harness.log.length = 0;

  harness.tools.draw(paneTarget(createStateContext()));
  harness.tools.drawBelowBars(drawingTarget(createStateContext()));
  harness.tools.pointerDown(5, 1);

  expect(paintLog(harness)).toEqual(['a:draw']);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.drawings.get('a')?.isVisible(drawingId)).toBe(true);
});

test('a drawing is painted and hit again on a timeframe its setting shows', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingTimeframeVisibility('a', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);
  harness.barSeries.timeframe = 'M1';
  harness.log.length = 0;

  harness.tools.draw(paneTarget(createStateContext()));
  harness.tools.pointerDown(5, 1);

  expect(paintLog(harness)).toEqual([`a:drawDrawing:${drawingId}`, 'a:draw']);
  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', drawingId, false, true));
});

test('the selection drops when a timeframe switch hides the selected drawing, not on a live bar', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingTimeframeVisibility('a', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);
  harness.barSeries.timeframe = 'M1';
  harness.tools.pointerDown(5, 1);
  harness.tools.barsChanged();
  expect(harness.tools.selectedDrawing()?.drawingId).toBe(drawingId);

  harness.barSeries.timeframe = START_TIMEFRAME;
  harness.tools.barsChanged();

  expect(harness.tools.selectedDrawing()).toBeNull();
});

test('the object tree can select a drawing the timeframe hides, and live bars keep it selected', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.tools.setDrawingTimeframeVisibility('a', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);

  harness.tools.selectDrawing('a', drawingId);
  harness.tools.barsChanged();

  expect(harness.tools.selectedDrawing()?.drawingId).toBe(drawingId);
});

test('setting the timeframe visibility reports one change, exports with the drawing and ignores unknown ones', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const drawingId = seedDrawing(harness, 'a', 5);
  harness.reports.drawingsChanged = 0;

  harness.tools.setDrawingTimeframeVisibility('a', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);
  harness.tools.setDrawingTimeframeVisibility('a', 'missing', SHOWN_ON_SHORT_MINUTES_ONLY);
  harness.tools.setDrawingTimeframeVisibility('missing', drawingId, SHOWN_ON_SHORT_MINUTES_ONLY);

  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.tools.exportDrawings().map(({ timeframeVisibility }) => timeframeVisibility)).toEqual([
    SHOWN_ON_SHORT_MINUTES_ONLY,
  ]);
});

test('the timeframe visibility survives an import and is forgotten with its drawing', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const record = {
    ...storedRecord({ id: 'a-1', belowBars: false }),
    inputs: { period: 20 },
    timeframeVisibility: SHOWN_ON_SHORT_MINUTES_ONLY,
  };

  harness.tools.replaceDrawings([record]);
  expect(harness.tools.exportDrawings()).toEqual([record]);

  harness.tools.deleteDrawing('a', 'a-1');
  harness.tools.replaceDrawings([storedRecord({ id: 'a-1', belowBars: false })]);
  expect(harness.tools.exportDrawings()[0].timeframeVisibility).toEqual(DEFAULT_TIMEFRAME_VISIBILITY);
});

test('a press picks the topmost drawing of the one order, across tools and below-bars drawings', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  const lower = seedDrawing(harness, 'a', 5);
  const upper = seedDrawing(harness, 'b', 5);

  harness.tools.pointerDown(5, 1);
  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('b', upper, false, true));

  // Below the bars the other drawing is on top, so the press follows the order, not the registry.
  harness.tools.moveStackEntry(2, 0);
  harness.tools.pointerDown(5, 1);
  expect(harness.tools.selectedDrawing()).toEqual(selectionOf('a', lower, false, true));
});

test('moving an entry reorders the paint, reports one change and refuses an invalid move', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  const first = seedDrawing(harness, 'a', 10);
  const second = seedDrawing(harness, 'b', 20);
  harness.log.length = 0;
  harness.reports.drawingsChanged = 0;

  expect(harness.tools.moveStackEntry(2, 1)).toBe(true);

  expect(harness.reports.drawingsChanged).toBe(1);
  harness.tools.draw(paneTarget(createStateContext()));
  expect(paintLog(harness)).toEqual([`b:drawDrawing:${second}`, `a:drawDrawing:${first}`, 'a:draw', 'b:draw']);

  expect(harness.tools.moveStackEntry(0, 9)).toBe(false);
  expect(harness.tools.moveStackEntry(1, 1)).toBe(false);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('moving an entry keeps the drawing order of each tool in step with the chart order', () => {
  const harness = buildToolSet({ toolIds: ['a'] });
  const first = seedDrawing(harness, 'a', 10);
  const second = seedDrawing(harness, 'a', 20);

  harness.tools.moveStackEntry(1, 2);

  expect(
    harness.drawings
      .get('a')
      ?.exportRecords()
      .map(({ id }) => id),
  ).toEqual([second, first]);
});

test('an export stamps the side of the bars from the marker and keeps the order bottom first', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  const below = seedDrawing(harness, 'b', 10);
  const above = seedDrawing(harness, 'a', 20);
  harness.tools.moveStackEntry(0, 1);

  expect(harness.tools.exportDrawings().map(({ id, belowBars }) => `${id}:${belowBars}`)).toEqual([
    `${below}:true`,
    `${above}:false`,
  ]);
});

test('an import rebuilds the order from the below-bars flag and the record order', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'] });
  harness.tools.replaceDrawings([
    storedRecord({ id: 'over-1', belowBars: false }),
    storedRecord({ id: 'under-1', belowBars: true }),
    storedRecord({ id: 'over-2', belowBars: false }),
    storedRecord({ id: 'under-2', belowBars: true }),
  ]);

  expect(harness.tools.exportDrawings().map(({ id, belowBars }) => `${id}:${belowBars}`)).toEqual([
    'under-1:true',
    'under-2:true',
    'over-1:false',
    'over-2:false',
  ]);
});

test('a newly placed drawing lands on top of the order', () => {
  const harness = buildToolSet({ toolIds: ['a', 'b'], placementToolIds: ['b'] });
  const existing = seedDrawing(harness, 'a', 10);
  harness.tools.selectTool('b');
  harness.tools.pointerDown(20, 0);
  harness.tools.pointerUp('released');
  const placed = harness.tools.selectedDrawing()?.drawingId;

  expect(harness.tools.exportDrawings().map(({ id }) => id)).toEqual([existing, placed]);
});

test('resetting every tool empties the order down to the bars marker', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 5);
  seedDrawing(harness, 'b', 6);

  harness.tools.resetTools('symbol');

  expect(harness.tools.drawingStack()).toEqual([{ kind: 'bars' }]);
  expect(harness.tools.exportDrawings()).toEqual([]);
});

test('a tool that places no drawings answers as if it had none', () => {
  const tools = new ChartToolSet(
    [{ id: 'pointer', placesDrawings: false, toolClass: ArrowTool }],
    'pointer',
    hostOn({ timeframe: START_TIMEFRAME }),
    {
      cursorChanged: () => undefined,
      selectionChanged: () => undefined,
      drawingsChanged: () => undefined,
    },
  );
  tools.activateDefaultTool();

  expect(tools.exportDrawings()).toEqual([]);
  expect(tools.deleteDrawing('pointer', 'missing')).toBe(false);
  expect(tools.pointerDown(1, 1)).toBe(false);
  tools.setDrawingVisible('pointer', 'missing', false);
  tools.setDrawingInputs('pointer', 'missing', { period: 1 });
  tools.replaceDrawings([{ ...storedRecord({ id: 'a-1', belowBars: false }), toolId: 'pointer' }]);
  expect(tools.exportDrawings()).toEqual([]);
});

test('resetting every tool clears the selection', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 5);
  harness.tools.pointerDown(5, 1);
  harness.tools.resetTools('symbol');
  expect(harness.tools.selectedDrawing()).toBeNull();
});

/** A context that tracks only what the isolation tests look at: line width and the save stack. */
function createStateContext() {
  const saved: number[] = [];
  const context = {
    lineWidth: 1,
    save: () => saved.push(context.lineWidth),
    restore: () => {
      context.lineWidth = saved.pop() ?? context.lineWidth;
    },
  };
  return context as unknown as CanvasRenderingContext2D;
}

test('a tool that changes canvas state does not leak it into the next tool', () => {
  const { tools, drawActions } = buildToolSet();
  const context = createStateContext();
  const seenByNextTool: number[] = [];
  drawActions.set('a', (ctx) => {
    ctx.lineWidth = 9;
  });
  drawActions.set('b', (ctx) => seenByNextTool.push(ctx.lineWidth));
  tools.draw(paneTarget(context));
  expect(seenByNextTool).toEqual([1]);
  expect(context.lineWidth).toBe(1);
});

test('canvas state is restored even when a tool throws while drawing', () => {
  const { tools, drawActions } = buildToolSet();
  const context = createStateContext();
  drawActions.set('a', (ctx) => {
    ctx.lineWidth = 9;
    throw new Error('draw failed');
  });
  expect(() => tools.draw(paneTarget(context))).toThrow('draw failed');
  expect(context.lineWidth).toBe(1);
});
