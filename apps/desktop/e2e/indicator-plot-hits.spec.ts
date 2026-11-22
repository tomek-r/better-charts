import { expect, test } from '@playwright/test';
import {
  HIT_TOLERANCE_CSS_PX,
  hitsInk,
  inkGap,
  segmentGap,
  type PlotChartPoint,
  type PlotInk,
} from '../src/features/chart/engine/indicators/indicatorPlotHits';
import { runInk, type PlotDrawing } from '../src/features/chart/engine/indicators/indicatorPlotInk';

/**
 * Where a click picks a plotted line: the distance to a straight run, the half width a marker adds to it,
 * the turn a stepped line takes at its later point, and the column a stem or a histogram plot grows from
 * its base. All of it is pane CSS pixels, measured against the pane it was drawn in.
 */

/** A line along y = 0 from x = 0 to x = 10. */
const LINE: PlotInk = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, halfWidth: 0 };

/** How far a marker's arms reach from its centre, and the marker centred at (20, 0). */
const MARKER_RADIUS = 3.5;
const MARKER: PlotInk = { from: { x: 20, y: 0 }, to: { x: 20, y: 0 }, halfWidth: MARKER_RADIUS };

/** One plot drawing that line and that marker. */
const LINE_AND_MARKER: readonly PlotInk[] = [LINE, MARKER];

/** Two points a run strokes between: rising 20 px over 10 px. */
const RISE: readonly PlotChartPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 20 },
];

/** The same run stroked straight, and stroked as a step. */
const STRAIGHT_LINE: PlotDrawing = { line: 'straight', mark: { kind: 'none' } };
const STEPPED_LINE: PlotDrawing = { line: 'stepped', mark: { kind: 'none' } };

test('a point on the line lies no distance from it, and one beside it is measured square to it', () => {
  expect(segmentGap({ x: 5, y: 0 }, LINE.from, LINE.to)).toBe(0);
  expect(segmentGap({ x: 4, y: 3 }, LINE.from, LINE.to)).toBe(3);
});

test('a point past an end of the line is measured from that end', () => {
  expect(segmentGap({ x: 13, y: 4 }, LINE.from, LINE.to)).toBe(5);
  expect(segmentGap({ x: -3, y: -4 }, LINE.from, LINE.to)).toBe(5);
});

test('a line whose ends meet is a point, and the gap is measured to it', () => {
  expect(segmentGap({ x: 3, y: 4 }, LINE.from, LINE.from)).toBe(5);
});

test('a marker reaches its own half width past its centre', () => {
  expect(inkGap({ x: 20, y: 0 }, MARKER)).toBe(-3.5);
  expect(inkGap({ x: 25, y: 0 }, MARKER)).toBe(1.5);
});

test('a click within the tolerance picks the plot, one just past it does not', () => {
  expect(hitsInk({ x: 5, y: HIT_TOLERANCE_CSS_PX }, LINE_AND_MARKER)).toBe(true);
  expect(hitsInk({ x: 5, y: HIT_TOLERANCE_CSS_PX + 1 }, LINE_AND_MARKER)).toBe(false);
  // Past the marker's own half width on top of the tolerance: off the plot.
  expect(hitsInk({ x: 20 + HIT_TOLERANCE_CSS_PX + MARKER_RADIUS + 1, y: 0 }, LINE_AND_MARKER)).toBe(false);
});

test('a stepped line turns where its later point sits, a straight one runs on to it', () => {
  expect(runInk(RISE, STEPPED_LINE)).toEqual([
    { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, halfWidth: 0 },
    { from: { x: 10, y: 0 }, to: { x: 10, y: 20 }, halfWidth: 0 },
  ]);
  expect(hitsInk({ x: 5, y: 0 }, runInk(RISE, STEPPED_LINE))).toBe(true);
  expect(hitsInk({ x: 5, y: 0 }, runInk(RISE, STRAIGHT_LINE))).toBe(false);
});

test('a plot drawn as markers has every point of it to pick, and no line between them', () => {
  const markers = runInk(RISE, { line: 'none', mark: { kind: 'marker' } });

  expect(markers).toHaveLength(2);
  expect(hitsInk({ x: 0, y: 3 }, markers)).toBe(true);
  expect(hitsInk({ x: 0, y: 8 }, markers)).toBe(false);
  // Halfway up the rise: on the line the markers would be joined by, but clear of both markers.
  expect(hitsInk({ x: 5, y: 10 }, markers)).toBe(false);
});

test('a column is picked along its height, from its value down to the price it grows from', () => {
  const columns = runInk([{ x: 0, y: 20 }], { line: 'none', mark: { kind: 'column', baseY: 100 } });

  expect(hitsInk({ x: 0, y: 60 }, columns)).toBe(true);
  expect(hitsInk({ x: 0, y: 110 }, columns)).toBe(false);
  expect(hitsInk({ x: 5, y: 60 }, columns)).toBe(false);
});

test('a run without a point draws no ink at all', () => {
  expect(runInk([], STRAIGHT_LINE)).toEqual([]);
  expect(hitsInk({ x: 0, y: 0 }, [])).toBe(false);
});
