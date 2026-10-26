import { expect, test } from '@playwright/test';
import type { ChartDrawingRecord } from '../src/features/chart/engine/drawings/drawingRecord';
import { LatestSaveQueue } from '../src/features/chart/drawingPersistence/latestSaveQueue';

/**
 * The save queue of one drawing scope: what the backend is asked to keep when edits
 * arrive faster than it can write, and what the user hears when a write is refused.
 * The module is DOM-free, so no browser is involved.
 */

/** One save the queue handed to the backend, with the handles that end it. */
interface PendingSave {
  readonly recordIds: string;
  readonly settle: () => void;
  readonly fail: (message: string) => void;
}

/** A backend save the test ends by hand, so a queue with one save in flight is observable. */
interface SaveSpy {
  readonly calls: PendingSave[];
  readonly save: (records: readonly ChartDrawingRecord[]) => Promise<void>;
}

/** The error callback the queue reports refusals to, recording every message the user would see. */
interface ErrorLog {
  readonly messages: string[];
  readonly record: (message: string) => void;
}

/** A save queue over a backend the test ends by hand, plus the error log it reports to. */
interface QueueUnderTest {
  readonly calls: PendingSave[];
  readonly queue: LatestSaveQueue;
  readonly errors: ErrorLog;
}

function pendingSaves(): SaveSpy {
  const calls: PendingSave[] = [];
  const save = (records: readonly ChartDrawingRecord[]) =>
    new Promise<void>((resolve, reject) => {
      calls.push({
        recordIds: records.map((record) => record.id).join(','),
        settle: resolve,
        fail: (message) => reject(new Error(message)),
      });
    });
  return { calls, save };
}

/** The list one edit produces: the drawings the chart holds at that moment. */
function drawingList(...ids: string[]): ChartDrawingRecord[] {
  return ids.map((id) => ({
    id,
    toolId: 'fixedRangeProfile',
    locked: false,
    visible: true,
    inputs: {},
    points: [{ timeMs: 0, price: null }],
  }));
}

/** The error callback, recording every message the user would see. */
function errorLog(): ErrorLog {
  const messages: string[] = [];
  return {
    messages,
    record: (message) => {
      messages.push(message);
    },
  };
}

/** A save queue with nothing in flight yet, ready for the first edit of a test. */
function queueUnderTest(): QueueUnderTest {
  const { calls, save } = pendingSaves();
  const errors = errorLog();
  return { calls, queue: new LatestSaveQueue(save, errors.record), errors };
}

/** Queues one edit per id given, in that order, each edit carrying the one drawing its id names. */
function enqueueEdits(queue: LatestSaveQueue, ...ids: string[]): void {
  for (const id of ids) {
    queue.enqueue(drawingList(id));
  }
}

/** The ids of every list the queue has sent so far, in order. */
function sentLists(calls: readonly PendingSave[]): string[] {
  return calls.map((call) => call.recordIds);
}

/** The newest save the queue started. */
function newest(calls: readonly PendingSave[]): PendingSave {
  return calls[calls.length - 1];
}

/** Lets the queue resume: a settled save hands control back on the microtask queue. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Settles the save in flight and lets the queue send whatever list it has waiting. */
async function settleNewest(calls: readonly PendingSave[]): Promise<void> {
  newest(calls).settle();
  await nextTurn();
}

test('saves reach the backend one at a time, in the order the edits were made', async () => {
  const { calls, queue, errors } = queueUnderTest();

  enqueueEdits(queue, 'first');
  expect(sentLists(calls)).toEqual(['first']);
  await settleNewest(calls);

  enqueueEdits(queue, 'second');
  expect(sentLists(calls)).toEqual(['first', 'second']);
  await settleNewest(calls);

  expect(sentLists(calls)).toEqual(['first', 'second']);
  expect(errors.messages).toEqual([]);
});

test('edits that arrive during a save collapse into the newest list', async () => {
  const { calls, queue, errors } = queueUnderTest();

  enqueueEdits(queue, 'first', 'second', 'third');
  // Only the save in flight runs; the two waiting lists became the newest one.
  expect(sentLists(calls)).toEqual(['first']);

  await settleNewest(calls);
  expect(sentLists(calls)).toEqual(['first', 'third']);

  await settleNewest(calls);
  expect(sentLists(calls)).toEqual(['first', 'third']);
  expect(errors.messages).toEqual([]);
});

test('a refused save is reported and the waiting list still runs', async () => {
  const { calls, queue, errors } = queueUnderTest();

  enqueueEdits(queue, 'first', 'second');
  newest(calls).fail('Drawings could not be saved');
  await nextTurn();

  expect(errors.messages).toEqual(['Drawings could not be saved']);
  expect(sentLists(calls)).toEqual(['first', 'second']);

  await settleNewest(calls);
  expect(sentLists(calls)).toEqual(['first', 'second']);
  expect(errors.messages).toEqual(['Drawings could not be saved']);
});
