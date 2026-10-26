import { test, expect } from '@playwright/test';
import { ChartDrawings, type ChartDrawingCommands } from '../src/features/chart/engine/drawings/chartDrawings';
import type { DrawingStackEntry } from '../src/features/chart/engine/drawings/drawingStack';
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

/** The tool every record of these cases belongs to. */
const TOOL_ID = 'trend-line';

/** The selection the fake commands report when a test needs one: the drawing its commands act on. */
const SELECTED_LINE: ChartDrawingSelection = {
  toolId: TOOL_ID,
  drawingId: 'line-1',
  locked: false,
  visible: true,
};

/** What the fake commands answer with; a test changes them to steer the drawings. */
interface CommandAnswers {
  /** The selection `selectedDrawing` answers with. */
  selection: ChartDrawingSelection | null;
  /** The records `exportDrawings` answers with, bottom of the stack first. */
  records: ChartDrawingRecord[];
  /** The chart's stacking order, bottom first. */
  stack: readonly DrawingStackEntry[];
  /** Whether deleting finds a drawing to remove. */
  removes: boolean;
  /** Whether the stack accepts the move it is asked for. */
  moves: boolean;
  /** Whether the tool accepts the anchors it is given. */
  acceptsPoints: boolean;
}

/** One call the fake commands received: the method name and the arguments it was given, unchanged. */
interface CommandCall {
  readonly name: keyof ChartDrawingCommands;
  readonly args: readonly unknown[];
}

/** The call every selection-dependent command makes first: reading what is selected. */
const SELECTION_READ: CommandCall = { name: 'selectedDrawing', args: [] };

interface Harness {
  drawings: ChartDrawings;
  /** The answers the fake commands give. */
  answers: CommandAnswers;
  /** Every call the fake commands received, in order. */
  calls: CommandCall[];
  /** What the drawings asked for, in order: a repaint, a selection report, a save request or a list read. */
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
    selectDrawing: (toolId, drawingId) => {
      calls.push({ name: 'selectDrawing', args: [toolId, drawingId] });
    },
    deleteDrawing: (toolId, drawingId) => {
      calls.push({ name: 'deleteDrawing', args: [toolId, drawingId] });
      return answers.removes;
    },
    setDrawingLocked: (toolId, drawingId, locked) => {
      calls.push({ name: 'setDrawingLocked', args: [toolId, drawingId, locked] });
    },
    setDrawingVisible: (toolId, drawingId, visible) => {
      calls.push({ name: 'setDrawingVisible', args: [toolId, drawingId, visible] });
    },
    setDrawingInputs: (toolId, drawingId, inputs) => {
      calls.push({ name: 'setDrawingInputs', args: [toolId, drawingId, inputs] });
    },
    setDrawingPoints: (toolId, drawingId, points) => {
      calls.push({ name: 'setDrawingPoints', args: [toolId, drawingId, points] });
      return answers.acceptsPoints;
    },
    exportDrawings: () => {
      calls.push({ name: 'exportDrawings', args: [] });
      return answers.records;
    },
    replaceDrawings: (records) => {
      calls.push({ name: 'replaceDrawings', args: [records] });
    },
    drawingStack: () => {
      calls.push({ name: 'drawingStack', args: [] });
      return answers.stack;
    },
    moveStackEntry: (fromIndex, toIndex) => {
      calls.push({ name: 'moveStackEntry', args: [fromIndex, toIndex] });
      return answers.moves;
    },
  };
}

/** One stored drawing under the id, with the flags the list carries through. */
function recordOf(id: string): ChartDrawingRecord {
  return { id, toolId: TOOL_ID, locked: false, visible: true, belowBars: false, inputs: {}, points: [ANCHOR] };
}

/** One stack entry naming a drawing of these cases' tool. */
function stackEntryOf(drawingId: string): DrawingStackEntry {
  return { kind: 'drawing', ref: { toolId: TOOL_ID, drawingId } };
}

/** The bars marker, as the tool set reports it. */
const BARS_STACK_ENTRY: DrawingStackEntry = { kind: 'bars' };

/** A layer list as readable names: 'bars', or the id of the record a drawing entry carries. */
function layerNames(drawings: ChartDrawings): string[] {
  return drawings.layerList().map((entry) => (entry.kind === 'bars' ? 'bars' : entry.record.id));
}

/** Records one change subscriber that pushes its label to the timeline; answers its unsubscribe. */
function recordChanges(drawings: ChartDrawings, timeline: string[], label = 'change'): () => void {
  return drawings.subscribeChanges(() => {
    timeline.push(label);
  });
}

/** Records one list reader that pushes 'list' to the timeline; answers its unsubscribe. */
function recordListReads(drawings: ChartDrawings, timeline: string[]): () => void {
  return drawings.subscribeLayerList(() => timeline.push('list'));
}

function buildHarness(): Harness {
  const calls: CommandCall[] = [];
  const timeline: string[] = [];
  const selections: Array<ChartDrawingSelection | null> = [];
  const answers: CommandAnswers = {
    selection: null,
    records: [],
    stack: [],
    removes: false,
    moves: false,
    acceptsPoints: true,
  };
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

test('deleting with nothing selected reports false and does not repaint', () => {
  const { drawings, calls, timeline } = buildHarness();
  expect(drawings.deleteSelected()).toBe(false);
  expect(calls).toEqual([SELECTION_READ]);
  expect(timeline).toEqual([]);
});

test('deleting the selection removes that drawing by id and repaints once', () => {
  const harness = buildHarness();
  harness.answers.selection = SELECTED_LINE;
  harness.answers.removes = true;
  expect(harness.drawings.deleteSelected()).toBe(true);
  expect(harness.calls[0]).toEqual(SELECTION_READ);
  expect(harness.calls[1]).toEqual({ name: 'deleteDrawing', args: ['trend-line', 'line-1'] });
  expect(harness.timeline).toEqual(['repaint']);
});

test('locking the selection reaches the commands with the same drawing, locked flag and one repaint', () => {
  const harness = buildHarness();
  harness.answers.selection = SELECTED_LINE;
  harness.drawings.setSelectedLocked(true);
  expect(harness.calls[0]).toEqual(SELECTION_READ);
  expect(harness.calls[1]).toEqual({ name: 'setDrawingLocked', args: ['trend-line', 'line-1', true] });
  expect(harness.timeline).toEqual(['repaint']);
});

test('selecting one drawing reaches the commands with the same arguments and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  drawings.select('trend-line', 'line-1');
  expect(calls).toEqual([{ name: 'selectDrawing', args: ['trend-line', 'line-1'] }]);
  expect(timeline).toEqual(['repaint']);
});

test('deleting one drawing asks the commands to remove it and repaints only when it did', () => {
  const harness = buildHarness();
  expect(harness.drawings.delete('trend-line', 'line-1')).toBe(false);
  expect(harness.calls).toEqual([{ name: 'deleteDrawing', args: ['trend-line', 'line-1'] }]);
  expect(harness.timeline).toEqual([]);

  harness.answers.removes = true;
  expect(harness.drawings.delete('trend-line', 'line-1')).toBe(true);
  expect(harness.timeline).toEqual(['repaint']);
});

test('locking one drawing reaches the commands with the same arguments and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  drawings.setLocked('trend-line', 'line-1', true);
  expect(calls).toEqual([{ name: 'setDrawingLocked', args: ['trend-line', 'line-1', true] }]);
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

test('new anchors go to the commands, repaint, and answer whether the tool accepted them', () => {
  const { drawings, answers, calls, timeline } = buildHarness();
  const points = [ANCHOR];

  expect(drawings.setPoints('trend-line', 'line-1', points)).toBe(true);
  answers.acceptsPoints = false;
  expect(drawings.setPoints('trend-line', 'line-1', points)).toBe(false);

  expect(calls).toEqual(Array(2).fill({ name: 'setDrawingPoints', args: ['trend-line', 'line-1', points] }));
  expect(timeline).toEqual(['repaint', 'repaint']);
});

test('replacing the records hands the same records to the commands and repaints once', () => {
  const { drawings, calls, timeline } = buildHarness();
  const records: ChartDrawingRecord[] = [recordOf('line-1')];
  drawings.replaceRecords(records);
  expect(calls).toEqual([{ name: 'replaceDrawings', args: [records] }]);
  expect(timeline).toEqual(['repaint']);
});

test('reading the selection and the records answers from the commands without repainting', () => {
  const harness = buildHarness();
  const selection: ChartDrawingSelection = { toolId: 'trend-line', drawingId: 'line-1', locked: true, visible: true };
  const records: ChartDrawingRecord[] = [{ ...recordOf('line-1'), locked: true, visible: false }];
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

test('the layer list is topmost first, with the bars between the drawings they sit between', () => {
  const harness = buildHarness();
  harness.answers.records = [recordOf('line-1'), recordOf('line-2')];
  harness.answers.stack = [stackEntryOf('line-1'), BARS_STACK_ENTRY, stackEntryOf('line-2')];

  expect(layerNames(harness.drawings)).toEqual(['line-2', 'bars', 'line-1']);
});

test('the layer list is read once and kept until the drawings change', () => {
  const harness = buildHarness();
  harness.answers.records = [recordOf('line-1')];
  harness.answers.stack = [BARS_STACK_ENTRY, stackEntryOf('line-1')];

  const list = harness.drawings.layerList();
  expect(harness.drawings.layerList()).toBe(list);
  expect(harness.calls.filter(({ name }) => name === 'exportDrawings')).toHaveLength(1);

  harness.drawings.drawingsChanged();

  expect(harness.drawings.layerList()).not.toBe(list);
});

test('a change, an import and a replace notice each hand out a fresh list and notify its readers', () => {
  const harness = buildHarness();
  harness.answers.records = [recordOf('line-1')];
  harness.answers.stack = [BARS_STACK_ENTRY, stackEntryOf('line-1')];
  recordListReads(harness.drawings, harness.timeline);
  const handedOut = [harness.drawings.layerList()];

  harness.drawings.drawingsChanged();
  handedOut.push(harness.drawings.layerList());
  harness.drawings.replaceRecords([recordOf('line-2')]);
  handedOut.push(harness.drawings.layerList());
  harness.drawings.drawingsReplaced();
  handedOut.push(harness.drawings.layerList());

  expect(new Set(handedOut).size).toBe(handedOut.length);
  expect(harness.timeline).toEqual(['list', 'change', 'list', 'repaint', 'list']);
});

test('a replace notice tells the layer readers and never asks the app to save', () => {
  const harness = buildHarness();
  recordListReads(harness.drawings, harness.timeline);

  harness.drawings.drawingsReplaced();

  expect(harness.timeline).toEqual(['list']);
});

test('imported records refresh the list without asking the app to save', () => {
  const harness = buildHarness();
  recordListReads(harness.drawings, harness.timeline);

  harness.drawings.replaceRecords([recordOf('line-1')]);

  expect(harness.timeline).toEqual(['list', 'repaint']);
});

test('one layer notice reaches every reader and stops reaching an unsubscribed one', () => {
  const harness = buildHarness();
  const stopReading = harness.drawings.subscribeLayerList(() => harness.timeline.push('second'));
  harness.drawings.subscribeLayerList(() => harness.timeline.push('first'));

  stopReading();
  harness.drawings.drawingsReplaced();

  expect(harness.timeline).toEqual(['first']);
});

test('moving a layer mirrors the topmost-first indexes into the bottom-first stack', () => {
  const harness = buildHarness();
  harness.answers.stack = [stackEntryOf('line-1'), BARS_STACK_ENTRY, stackEntryOf('line-2')];
  harness.answers.moves = true;

  harness.drawings.moveLayer(0, 2);
  harness.drawings.moveLayer(1, 0);

  expect(harness.calls).toContainEqual({ name: 'moveStackEntry', args: [2, 0] });
  expect(harness.calls).toContainEqual({ name: 'moveStackEntry', args: [1, 2] });
  expect(harness.timeline).toEqual(['repaint', 'repaint']);
});

test('a moved layer that the stack refuses repaints nothing', () => {
  const harness = buildHarness();
  harness.answers.stack = [stackEntryOf('line-1'), BARS_STACK_ENTRY, stackEntryOf('line-2')];

  harness.drawings.moveLayer(1, 1);

  expect(harness.calls).toContainEqual({ name: 'moveStackEntry', args: [1, 1] });
  expect(harness.timeline).toEqual([]);
});
