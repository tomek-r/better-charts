import { test, expect } from '@playwright/test';
import {
  DrawingStack,
  type DrawingRef,
  type DrawingStackEntry,
} from '../src/features/chart/engine/drawings/drawingStack';

/**
 * The chart's one stacking order: the drawings of every tool plus the price-bars marker, healed against
 * the drawings that really exist. The class is DOM-free, so no browser is needed.
 */

/** One drawing of a tool, as the order names it. */
function refOf(toolId: string, drawingId: string): DrawingRef {
  return { toolId, drawingId };
}

/** A stack entry as a readable name: 'bars', or 'toolId:drawingId'. */
function entryName(entry: DrawingStackEntry): string {
  return entry.kind === 'bars' ? 'bars' : `${entry.ref.toolId}:${entry.ref.drawingId}`;
}

/** The order as readable names, bottom first. */
function stackedNames(stack: DrawingStack, existing: readonly DrawingRef[]): string[] {
  return stack.entries(existing).map(entryName);
}

test('the marker is the only entry of an order that has seen no drawings', () => {
  const stack = new DrawingStack();
  expect(stackedNames(stack, [])).toEqual(['bars']);
});

test('the order drops a stacked drawing that went away', () => {
  const stack = new DrawingStack();
  const first = refOf('a', 'one');
  const second = refOf('b', 'two');
  stack.entries([first, second]);

  expect(stackedNames(stack, [first])).toEqual(['bars', 'a:one']);
});

test('a drawing not stacked yet is added on top, in the order given', () => {
  const stack = new DrawingStack();
  stack.entries([refOf('a', 'one')]);

  expect(stackedNames(stack, [refOf('a', 'one'), refOf('b', 'two'), refOf('a', 'three')])).toEqual([
    'bars',
    'a:one',
    'b:two',
    'a:three',
  ]);
});

test('a drawing added later sits above one that was stacked first', () => {
  const stack = new DrawingStack();
  const older = refOf('a', 'one');
  const newer = refOf('a', 'two');
  stack.entries([older]);
  stack.entries([older, newer]);

  expect(stackedNames(stack, [older, newer])).toEqual(['bars', 'a:one', 'a:two']);
});

test('replacing rebuilds both sides of the marker from the stored flag and order', () => {
  const stack = new DrawingStack();
  const overOne = refOf('a', 'over-1');
  const underOne = refOf('a', 'under-1');
  const overTwo = refOf('b', 'over-2');
  const underTwo = refOf('b', 'under-2');
  stack.replace([
    { ref: overOne, belowBars: false },
    { ref: underOne, belowBars: true },
    { ref: overTwo, belowBars: false },
    { ref: underTwo, belowBars: true },
  ]);

  expect(stackedNames(stack, [overOne, underOne, overTwo, underTwo])).toEqual([
    'a:under-1',
    'b:under-2',
    'bars',
    'a:over-1',
    'b:over-2',
  ]);
});

test('moving an entry reorders the order, across the marker as well', () => {
  const stack = new DrawingStack();
  const over = refOf('a', 'over');
  const under = refOf('a', 'under');
  stack.replace([
    { ref: over, belowBars: false },
    { ref: under, belowBars: true },
  ]);
  expect(stackedNames(stack, [over, under])).toEqual(['a:under', 'bars', 'a:over']);

  expect(stack.move(1, 0)).toBe(true);

  expect(stackedNames(stack, [over, under])).toEqual(['bars', 'a:under', 'a:over']);
});

test('a move out of range or onto itself changes nothing and answers false', () => {
  const stack = new DrawingStack();
  const one = refOf('a', 'one');
  const two = refOf('a', 'two');
  stack.entries([one, two]);

  expect(stack.move(0, 3)).toBe(false);
  expect(stack.move(-1, 0)).toBe(false);
  expect(stack.move(1, 1)).toBe(false);

  expect(stackedNames(stack, [one, two])).toEqual(['bars', 'a:one', 'a:two']);
});

test('clearing keeps the marker alone, at the bottom', () => {
  const stack = new DrawingStack();
  stack.entries([refOf('a', 'one')]);
  stack.move(0, 1);

  stack.clear();

  expect(stackedNames(stack, [])).toEqual(['bars']);
});
