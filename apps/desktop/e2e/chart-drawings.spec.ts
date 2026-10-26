import { test, expect } from '@playwright/test';
import { ChartDrawings, type ChartDrawingCommands } from '../src/features/chart/engine/drawings/chartDrawings';
import type {
  ChartDrawingPoint,
  ChartDrawingRecord,
  ChartDrawingSelection,
} from '../src/features/chart/engine/drawings/drawingRecord';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';

/**
 * What the chart's drawings delegate to the command port and what they report back to the app,
 * with a fake port that records every call. The class is DOM-free, so no browser is needed.
 */

/** One anchor point of a stored drawing; these commands pass it through untouched. */
const ANCHOR: ChartDrawingPoint = { timeMs: 1_700_000_000_000, price: null };

/** What the fake commands answer with; a test changes them to steer the drawings. */
interface CommandAnswers {
  /** The selection `selectedDrawing` answers with. */
  selection: ChartDrawingSelection | null;
  /** The records `exportDrawings` answers with. */
  records: ChartDrawingRecord[];
  /** Whether deleting finds a drawing to remove. */
  removes: boolean;
}

/** One call the fake commands received: the method name and the arguments it was given, unchanged. */
interface CommandCall {
  readonly name: keyof ChartDrawingCommands;
  readonly args: readonly unknown[];
}

interface Harness {
  drawings: ChartDrawings;
  /** The answers the fake commands give. */
  answers: CommandAnswers;
  /** Every call the fake commands received, in order. */
  calls: CommandCall[];
  /** What the drawings asked for, in order: a repaint, a selection report or a save request. */
  timeline: string[];
  /** Every selection reported to the app, in order; a null entry is a cleared selection. */
  selections: Array<ChartDrawingSelection | null>;
}

function commandsFor(answers: CommandAnswers, calls: CommandCall[]): ChartDrawingCommands {
  return {
    selectedDrawing: () => {
      calls.push({ name: 'selectedDrawing', args: [] });
      return answers.selection;
    },
    deleteSelectedDrawing: () => {
      calls.push({ name: 'deleteSelectedDrawing', args: [] });
      return answers.removes;
    },
    setSelectedDrawingLocked: (locked) => {
      calls.push({ name: 'setSelectedDrawingLocked', args: [locked] });
    },
    setDrawingVisible: (toolId, drawingId, visible) => {
      calls.push({ name: 'setDrawingVisible', args: [toolId, drawingId, visible] });
    },
    setDrawingInputs: (toolId, drawingId, inputs) => {
      calls.push({ name: 'setDrawingInputs', args: [toolId, drawingId, inputs] });
    },
    exportDrawings: () => {
      calls.push({ name: 'exportDrawings', args: [] });
      return answers.records;
    },
    replaceDrawings: (records) => {
      calls.push({ name: 'replaceDrawings', args: [records] });
    },
  };
}

/** Records one change subscriber that pushes its label to the timeline; answers its unsubscribe. */
function recordChanges(drawings: ChartDrawings, timeline: string[], label = 'change'): () => void {
  return drawings.subscribeChanges(() => {
    timeline.push(label);
  });
}

function buildHarness(): Harness {
  const calls: CommandCall[] = [];
  const timeline: string[] = [];
  const selections: Array<ChartDrawingSelection | null> = [];
  const answers: CommandAnswers = { selection: null, records: [], removes: false };
  const drawings = new ChartDrawings(commandsFor(answers, calls), () => {
    timeline.push('repaint');
  });
  drawings.subscribeSelection((selection) => {
    timeline.push('selection');
    selections.push(selection);
  });
  recordChanges(drawings, timeline);
  return { drawings, answers, calls, timeline, selections };
}

test('deleting when the commands removed nothing reports false and does not repaint', () => {
  const { drawings, calls, timeline } = buildHarness();
  expect(drawings.deleteSelected()).toBe(false);
  expect(calls).toEqual([{ name: 'deleteSelectedDrawing', args: [] }]);
  expect(timeline).toEqual([]);
});

test('deleting reports true and repaints once when the commands removed a drawing', () => {
  const harness = buildHarness();
  harness.answers.removes = true;
  expect(harness.drawings.deleteSelected()).toBe(true);
  expect(harness.timeline).toEqual(['repaint']);
});

test('locking the selection reaches the commands with the same flag and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  drawings.setSelectedLocked(true);
  expect(calls).toEqual([{ name: 'setSelectedDrawingLocked', args: [true] }]);
  expect(timeline).toEqual(['repaint']);
});

test('hiding a drawing reaches the commands with the same arguments and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  drawings.setVisible('trend-line', 'line-1', false);
  expect(calls).toEqual([{ name: 'setDrawingVisible', args: ['trend-line', 'line-1', false] }]);
  expect(timeline).toEqual(['repaint']);
});

test('new settings reach the commands with the same arguments and repaint once', () => {
  const { drawings, calls, timeline } = buildHarness();
  const inputs: ToolInputValues = { period: 30 };
  drawings.setInputs('trend-line', 'line-1', inputs);
  expect(calls).toEqual([{ name: 'setDrawingInputs', args: ['trend-line', 'line-1', inputs] }]);
  expect(timeline).toEqual(['repaint']);
});

test('replacing the records hands the same records to the commands and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  const records: ChartDrawingRecord[] = [
    { id: 'line-1', toolId: 'trend-line', locked: false, visible: true, inputs: {}, points: [ANCHOR] },
  ];
  drawings.replaceRecords(records);
  expect(calls).toEqual([{ name: 'replaceDrawings', args: [records] }]);
  expect(timeline).toEqual(['repaint']);
});

test('reading the selection and the records answers from the commands without repainting', () => {
  const harness = buildHarness();
  const selection: ChartDrawingSelection = { toolId: 'trend-line', drawingId: 'line-1', locked: true, visible: true };
  const records: ChartDrawingRecord[] = [
    { id: 'line-1', toolId: 'trend-line', locked: true, visible: false, inputs: {}, points: [ANCHOR] },
  ];
  harness.answers.selection = selection;
  harness.answers.records = records;
  expect(harness.drawings.selected()).toBe(selection);
  expect(harness.drawings.exportRecords()).toBe(records);
  expect(harness.timeline).toEqual([]);
});

test('a new selection repaints before the app is told about it', () => {
  const { drawings, timeline, selections } = buildHarness();
  const selection: ChartDrawingSelection = {
    toolId: 'trend-line',
    drawingId: 'line-1',
    locked: false,
    visible: true,
  };
  drawings.selectionChanged(selection);
  expect(timeline).toEqual(['repaint', 'selection']);
  expect(selections).toEqual([selection]);
});

test('a changed drawing set asks the app to save without repainting', () => {
  const { drawings, timeline } = buildHarness();
  drawings.drawingsChanged();
  expect(timeline).toEqual(['change']);
});

test('one change reaches every subscriber and stops reaching an unsubscribed one', () => {
  const { drawings, timeline } = buildHarness();
  const stopsSecond = recordChanges(drawings, timeline, 'second');
  const stopsThird = recordChanges(drawings, timeline, 'third');
  stopsThird();
  drawings.drawingsChanged();
  expect(timeline).toEqual(['change', 'second']);
  stopsSecond();
  drawings.drawingsChanged();
  expect(timeline).toEqual(['change', 'second', 'change']);
});
