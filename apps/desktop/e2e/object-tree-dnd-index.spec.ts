import { expect, test } from '@playwright/test';
import { dropTargetIndex, type DropEdge } from '../src/features/object-tree/layerDropTarget';

/**
 * Where a dragged object-tree row lands. The drop names an insertion point (above or below the row
 * under the pointer), and the answer is the row's final list index once it has left its old place.
 * The index maths is pure, so no browser page is involved.
 */

interface DropCase {
  readonly name: string;
  readonly source: number;
  readonly target: number;
  readonly edge: DropEdge;
  readonly landsAt: number;
}

/** Each case is worked out by hand on a five-row list, indexes 0 (top) to 4 (bottom). */
const DROP_CASES: readonly DropCase[] = [
  { name: 'moving up, above the target', source: 3, target: 1, edge: 'before', landsAt: 1 },
  { name: 'moving up, below the target', source: 3, target: 1, edge: 'after', landsAt: 2 },
  { name: 'moving down, above the target', source: 1, target: 3, edge: 'before', landsAt: 2 },
  { name: 'moving down, below the target', source: 1, target: 3, edge: 'after', landsAt: 3 },
  { name: 'onto its own top edge', source: 2, target: 2, edge: 'before', landsAt: 2 },
  { name: 'onto its own bottom edge', source: 2, target: 2, edge: 'after', landsAt: 2 },
  { name: 'below the row above it', source: 2, target: 1, edge: 'after', landsAt: 2 },
  { name: 'above the row below it', source: 2, target: 3, edge: 'before', landsAt: 2 },
  { name: 'to the first position', source: 3, target: 0, edge: 'before', landsAt: 0 },
  { name: 'to the last position', source: 1, target: 4, edge: 'after', landsAt: 4 },
];

for (const { name, source, target, edge, landsAt } of DROP_CASES) {
  test(`dropTargetIndex: ${name}`, () => {
    expect(dropTargetIndex(source, target, edge)).toBe(landsAt);
  });
}
