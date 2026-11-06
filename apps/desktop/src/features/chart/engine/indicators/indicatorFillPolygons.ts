/**
 * Turns the per-bar edges of a fill into canvas polygons.
 *
 * A fill is a band between two edges (two plots, a plot and a level, or two
 * levels). Each bar where both edges have a value contributes one column; the
 * band is drawn as a polygon through the columns of an unbroken run.
 */

/** One bar of a fill: the pixel x of the bar and the pixel y of both edges. */
export interface FillColumn {
  readonly x: number;
  readonly from: number | null;
  readonly to: number | null;
}

/** A point of a fill polygon, in the same pixel space as `FillColumn`. */
export interface FillPoint {
  readonly x: number;
  readonly y: number;
}

/** A run of one column cannot enclose a band, so it is dropped. */
const MINIMUM_COLUMNS_PER_POLYGON = 2;

interface CompleteFillColumn {
  readonly x: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Splits the columns at every bar whose band is broken, dropping runs too short
 * to draw. Each polygon runs along the `from` edge left to right and returns
 * along the `to` edge right to left.
 */
export function fillPolygons(columns: readonly FillColumn[]): FillPoint[][] {
  const polygons: FillPoint[][] = [];
  let run: CompleteFillColumn[] = [];
  for (const column of columns) {
    if (column.from === null || column.to === null) {
      appendPolygon(polygons, run);
      run = [];
      continue;
    }
    run.push({ x: column.x, from: column.from, to: column.to });
  }
  appendPolygon(polygons, run);
  return polygons;
}

function appendPolygon(polygons: FillPoint[][], run: readonly CompleteFillColumn[]): void {
  if (run.length < MINIMUM_COLUMNS_PER_POLYGON) {
    return;
  }
  polygons.push(toPolygon(run));
}

function toPolygon(run: readonly CompleteFillColumn[]): FillPoint[] {
  const polygon: FillPoint[] = [];
  for (const column of run) {
    polygon.push({ x: column.x, y: column.from });
  }
  for (let index = run.length - 1; index >= 0; index -= 1) {
    polygon.push({ x: run[index].x, y: run[index].to });
  }
  return polygon;
}
