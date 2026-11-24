/** One column bar as the box grid is read off it: the box level it opened at and the one it closed at. */
export interface PointFigureBar {
  readonly open: number;
  readonly close: number;
}

/**
 * The significant digits a distance keeps as its own value. The prices reach the chart as the broker's decimal
 * text parsed into doubles, so one box measured between two columns carries that parse's last-bit error, while
 * the grid a chart type drew on is many orders of magnitude coarser.
 */
const DISTANCE_DIGITS = 12;

/** A price distance as the box level it names, free of the error the decimal text picked up on the way in. */
function boxDistance(distance: number): number {
  return Number(distance.toPrecision(DISTANCE_DIGITS));
}

/**
 * The box size the columns were drawn on, which their own prices have to yield: the chart's bars carry the boxes,
 * not the grid they sit on.
 *
 * A reversal column opens exactly one box beyond the tip of the column before it — the command that draws the
 * columns puts it there — so the distance between a column's open and the previous column's close is one box, for
 * every column but the first. The distance the most columns name is the grid; a distance of none (two columns that
 * opened and closed on the same box) says nothing and is skipped. A chart of one column has no reversal to read,
 * so the column's own height stands in for the box, which draws its two ends as its two marks.
 */
export function pointFigureBoxSize(bars: readonly PointFigureBar[]): number {
  const counts = new Map<number, number>();
  let grid = 0;
  let gridCount = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const column = bars[index];
    if (previous === undefined || column === undefined) {
      continue;
    }
    const distance = boxDistance(Math.abs(column.open - previous.close));
    if (distance <= 0) {
      continue;
    }
    const count = (counts.get(distance) ?? 0) + 1;
    counts.set(distance, count);
    if (count > gridCount) {
      grid = distance;
      gridCount = count;
    }
  }
  if (gridCount > 0) {
    return grid;
  }
  const only = bars[0];
  return only === undefined ? 0 : Math.abs(only.close - only.open);
}
