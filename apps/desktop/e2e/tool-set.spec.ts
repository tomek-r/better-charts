import { test, expect } from '@playwright/test';
import { ChartToolSet } from '../src/features/chart/engine/tools/toolSet';
import type {
  ChartDrawingPoint,
  ChartDrawingRecord,
  ChartDrawingSelection,
  ChartToolDrawingRecord,
} from '../src/features/chart/engine/drawings/drawingRecord';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import type {
  ChartDrawTarget,
  ChartPointerUpOutcome,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
  ChartToolHostBase,
} from '../src/features/chart/engine/tools/toolContract';

/**
 * Routing and lifecycle rules of the engine's tool set, with fake tools that log every
 * call they receive and keep their drawings in memory. The set is DOM-free, so no
 * browser is needed.
 */

/** One anchor point, which the fake tools keep unchanged: the set routes them, it never reads them. */
const ORIGIN_POINT: ChartDrawingPoint = { timeMs: 0, price: null };

/** One fake tool's drawings, with the pane x a press hits each of them at. */
interface FakeDrawings {
  readonly records: ChartToolDrawingRecord[];
  readonly hitAtX: Map<number, string>;
}

/** How often the set reported something worth saving. */
interface ChangeReports {
  drawingsChanged: number;
}

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
  /** Each fake tool's in-memory drawings, keyed by tool id. */
  drawings: Map<string, FakeDrawings>;
}

function buildToolSet(toolIds = ['a', 'b', 'c'], placementToolIds: readonly string[] = []): Harness {
  const log: string[] = [];
  const cursors: Array<string | undefined> = [];
  const selections: Array<ChartDrawingSelection | null> = [];
  const reports: ChangeReports = { drawingsChanged: 0 };
  const gesturing = new Set<string>();
  const drawActions = new Map<string, (context: CanvasRenderingContext2D) => void>();
  const drawings = new Map<string, FakeDrawings>();
  const definitions: ChartToolDefinition[] = toolIds.map((id) => {
    const state: FakeDrawings = { records: [], hitAtX: new Map() };
    const placesDrawings = placementToolIds.includes(id);
    drawings.set(id, state);
    return {
      id,
      cursor: `cursor-${id}`,
      placesDrawings,
      toolClass: class implements ChartTool {
        private placedCount = 0;
        private pressing: { x: number; y: number } | null = null;

        constructor(private readonly host: ChartToolHost) {}

        hasGesture = () => gesturing.has(id);
        cancelGesture = () => log.push(`${id}:cancelGesture`);
        activate = () => log.push(`${id}:activate`);
        deactivate = () => log.push(`${id}:deactivate`);
        pointerHover = (x: number, y: number) => log.push(`${id}:pointerHover(${x},${y})`);
        pointerLeave = () => log.push(`${id}:pointerLeave`);
        setSelectedDrawing = (drawingId: string | null) => log.push(`${id}:setSelectedDrawing(${drawingId})`);
        drawingAt = (x: number) => state.hitAtX.get(x) ?? null;
        exportDrawings = () => state.records.map((record) => ({ ...record }));
        importDrawings = (records: readonly ChartToolDrawingRecord[]) =>
          state.records.splice(0, state.records.length, ...records);
        draw = ({ context }: ChartDrawTarget) => drawActions.get(id)?.(context);
        setDrawingLocked = (drawingId: string, locked: boolean) => this.updateDrawing(drawingId, { locked });
        setDrawingInputs = (drawingId: string, inputs: ToolInputValues) => this.updateDrawing(drawingId, { inputs });
        deleteDrawing = (drawingId: string) => this.removeDrawing(drawingId);

        pointerDown = (x: number, y: number) => {
          if (!placesDrawings) {
            return false;
          }
          this.pressing = { x, y };
          return true;
        };

        pointerUp = (outcome: ChartPointerUpOutcome) => {
          const press = this.pressing;
          this.pressing = null;
          if (press === null) {
            return false;
          }
          if (outcome === 'released') {
            this.commitDrawing(press.x);
          }
          return true;
        };

        private commitDrawing(x: number): void {
          const drawingId = `drawing-${id}-${this.placedCount}`;
          this.placedCount += 1;
          state.records.push({
            id: drawingId,
            locked: false,
            visible: true,
            inputs: {},
            points: [ORIGIN_POINT],
          });
          state.hitAtX.set(x, drawingId);
          this.host.drawingPlaced(drawingId);
        }

        private updateDrawing(drawingId: string, patch: Partial<ChartToolDrawingRecord>): boolean {
          const index = this.drawingIndex(drawingId);
          if (index < 0) {
            return false;
          }
          state.records[index] = { ...state.records[index], ...patch };
          return true;
        }

        private removeDrawing(drawingId: string): boolean {
          const index = this.drawingIndex(drawingId);
          if (index < 0) {
            return false;
          }
          state.records.splice(index, 1);
          return true;
        }

        private drawingIndex(drawingId: string): number {
          return state.records.findIndex((record) => record.id === drawingId);
        }
      },
    };
  });
  const tools = new ChartToolSet(definitions, 'a', {} as ChartToolHostBase, {
    cursorChanged: (cursor) => cursors.push(cursor),
    selectionChanged: (selection) => selections.push(selection),
    drawingsChanged: () => {
      reports.drawingsChanged += 1;
    },
  });
  tools.activateDefaultTool();
  log.length = 0;
  cursors.length = 0;
  return { tools, log, cursors, selections, reports, gesturing, drawActions, drawings };
}

/** Seeds one committed, unlocked drawing on a fake tool, hittable at pane x. */
function seedDrawing(harness: Harness, toolId: string, drawingId: string, x: number): void {
  const state = harness.drawings.get(toolId);
  if (state === undefined) {
    throw new Error(`No fake tool "${toolId}"`);
  }
  state.records.push({ id: drawingId, locked: false, visible: true, inputs: {}, points: [ORIGIN_POINT] });
  state.hitAtX.set(x, drawingId);
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

test('a press picks the drawing of the tool registered last under the pointer', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 'a-low', 10);
  seedDrawing(harness, 'c', 'c-high', 10);
  harness.tools.pointerDown(10, 5);
  const selection = { toolId: 'c', drawingId: 'c-high', locked: false };
  expect(harness.tools.selectedDrawing()).toEqual(selection);
  expect(harness.selections).toEqual([selection]);
  expect(harness.log).toContain('c:setSelectedDrawing(c-high)');
});

test('a press that hits no drawing clears the selection and unhighlights the old one', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'b', 'b-1', 5);
  harness.tools.pointerDown(5, 1);
  harness.log.length = 0;
  harness.tools.pointerDown(50, 1);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.log).toContain('b:setSelectedDrawing(null)');
  expect(harness.selections).toEqual([{ toolId: 'b', drawingId: 'b-1', locked: false }, null]);
});

test('a press with a placement tool active leaves the selection alone', () => {
  const harness = buildToolSet(['a', 'b'], ['b']);
  seedDrawing(harness, 'a', 'a-1', 10);
  harness.tools.selectTool('b');
  harness.tools.pointerDown(20, 0);
  harness.tools.pointerUp('released');
  const placed = harness.tools.selectedDrawing();
  expect(placed).toEqual({ toolId: 'b', drawingId: 'drawing-b-0', locked: false });
  harness.tools.pointerDown(10, 0);
  expect(harness.tools.selectedDrawing()).toEqual(placed);
});

test('selecting a placement tool clears the selection', () => {
  const harness = buildToolSet(['a', 'b'], ['b']);
  seedDrawing(harness, 'a', 'a-1', 10);
  harness.tools.pointerDown(10, 0);
  expect(harness.tools.selectedDrawing()).not.toBeNull();
  harness.tools.selectTool('b');
  expect(harness.tools.selectedDrawing()).toBeNull();
});

test('a newly placed drawing becomes selected and the change is reported once', () => {
  const harness = buildToolSet(['a', 'b'], ['b']);
  harness.tools.selectTool('b');
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  harness.tools.pointerDown(20, 0);
  harness.tools.pointerUp('released');
  expect(harness.tools.selectedDrawing()).toEqual({ toolId: 'b', drawingId: 'drawing-b-0', locked: false });
  expect(harness.selections).toHaveLength(1);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('the selected drawing is deleted even when locked, and the selection is dropped', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 'a-1', 5);
  harness.tools.pointerDown(5, 1);
  harness.tools.setSelectedDrawingLocked(true);
  harness.reports.drawingsChanged = 0;
  expect(harness.tools.deleteSelectedDrawing()).toBe(true);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('a')?.records).toEqual([]);
});

test('deleting with nothing selected changes nothing', () => {
  const harness = buildToolSet();
  expect(harness.tools.deleteSelectedDrawing()).toBe(false);
  expect(harness.reports.drawingsChanged).toBe(0);
});

test('locking the selected drawing updates the selection and reports the change once', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 'a-1', 5);
  harness.tools.pointerDown(5, 1);
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  harness.tools.setSelectedDrawingLocked(true);
  const locked = { toolId: 'a', drawingId: 'a-1', locked: true };
  expect(harness.tools.selectedDrawing()).toEqual(locked);
  expect(harness.selections).toEqual([locked]);
  expect(harness.reports.drawingsChanged).toBe(1);
});

test('new settings on a drawing are reported only when the tool accepts them', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 'a-1', 5);
  harness.tools.setDrawingInputs('a', 'a-1', { period: 30 });
  expect(harness.reports.drawingsChanged).toBe(1);
  harness.tools.setDrawingInputs('a', 'missing', { period: 50 });
  expect(harness.reports.drawingsChanged).toBe(1);
  expect(harness.drawings.get('a')?.records[0]?.inputs).toEqual({ period: 30 });
});

test('exported drawings are stamped with their tool, in registry order', () => {
  const harness = buildToolSet(['b', 'a']);
  seedDrawing(harness, 'b', 'b-1', 1);
  seedDrawing(harness, 'a', 'a-1', 2);
  const stamped = harness.tools.exportDrawings().map(({ toolId, id }) => `${toolId}:${id}`);
  expect(stamped).toEqual(['b:b-1', 'a:a-1']);
});

test('importing hands each tool only its own records, drops unknown tools and reports nothing', () => {
  const harness = buildToolSet(['a', 'b']);
  seedDrawing(harness, 'a', 'stale', 5);
  harness.tools.pointerDown(5, 1);
  harness.selections.length = 0;
  harness.reports.drawingsChanged = 0;
  const records: ChartDrawingRecord[] = [
    { id: 'a-1', toolId: 'a', locked: false, visible: true, inputs: {}, points: [ORIGIN_POINT] },
    { id: 'b-1', toolId: 'b', locked: true, visible: false, inputs: { period: 20 }, points: [ORIGIN_POINT] },
    { id: 'c-1', toolId: 'c', locked: false, visible: true, inputs: {}, points: [ORIGIN_POINT] },
  ];
  harness.tools.replaceDrawings(records);
  expect(harness.tools.selectedDrawing()).toBeNull();
  expect(harness.selections).toEqual([null]);
  expect(harness.drawings.get('a')?.records.map(({ id }) => id)).toEqual(['a-1']);
  expect(harness.drawings.get('b')?.records.map(({ id }) => id)).toEqual(['b-1']);
  expect(harness.reports.drawingsChanged).toBe(0);
});

test('resetting every tool clears the selection', () => {
  const harness = buildToolSet();
  seedDrawing(harness, 'a', 'a-1', 5);
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
  tools.draw({ context } as ChartDrawTarget);
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
  expect(() => tools.draw({ context } as ChartDrawTarget)).toThrow('draw failed');
  expect(context.lineWidth).toBe(1);
});
