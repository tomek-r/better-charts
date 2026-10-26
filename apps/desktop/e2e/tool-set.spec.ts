import { test, expect } from '@playwright/test';
import { ChartToolSet } from '../src/features/chart/engine/tools/toolSet';
import type {
  ChartDrawTarget,
  ChartTool,
  ChartToolDefinition,
  ChartToolHost,
} from '../src/features/chart/engine/tools/toolContract';

/**
 * Routing and lifecycle rules of the engine's tool set, with fake tools that log every
 * call they receive. The set is DOM-free, so no browser is needed.
 */

interface Harness {
  tools: ChartToolSet;
  /** Every call the fake tools received, as `toolId:call`, in order. */
  log: string[];
  cursors: Array<string | undefined>;
  /** Ids of the tools that report a gesture in progress. */
  gesturing: Set<string>;
  /** Extra `draw` behavior per tool id, to prove draw isolation. */
  drawActions: Map<string, (context: CanvasRenderingContext2D) => void>;
}

function buildToolSet(toolIds = ['a', 'b', 'c']): Harness {
  const log: string[] = [];
  const cursors: Array<string | undefined> = [];
  const gesturing = new Set<string>();
  const drawActions = new Map<string, (context: CanvasRenderingContext2D) => void>();
  const definitions: ChartToolDefinition[] = toolIds.map((id) => ({
    id,
    cursor: `cursor-${id}`,
    placesDrawings: false,
    toolClass: class implements ChartTool {
      hasGesture = () => gesturing.has(id);
      cancelGesture = () => log.push(`${id}:cancelGesture`);
      activate = () => log.push(`${id}:activate`);
      deactivate = () => log.push(`${id}:deactivate`);
      pointerHover = (x: number, y: number) => log.push(`${id}:pointerHover(${x},${y})`);
      pointerLeave = () => log.push(`${id}:pointerLeave`);
      draw = ({ context }: ChartDrawTarget) => drawActions.get(id)?.(context);
    },
  }));
  const tools = new ChartToolSet(definitions, 'a', {} as ChartToolHost, (cursor) => cursors.push(cursor));
  tools.activateDefaultTool();
  log.length = 0;
  cursors.length = 0;
  return { tools, log, cursors, gesturing, drawActions };
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
