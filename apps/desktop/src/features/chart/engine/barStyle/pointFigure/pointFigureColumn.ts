import type { PointFigureBar } from './pointFigureBox';

/** One column as the renderer prints it: the way it runs and the box levels its marks sit on. */
export interface PointFigureColumn {
  readonly rising: boolean;
  readonly levels: readonly number[];
}

/**
 * The marks one column prints: an X for every box of a rising column and an O for every box of a falling one,
 * from the box it opened at to the box it closed at, both included. A column that closed exactly where it opened
 * fills one box, so it prints the single mark of that box; a column with no grid to step by prints the same.
 */
export function pointFigureColumn(bar: PointFigureBar, boxSize: number): PointFigureColumn {
  const rising = bar.close > bar.open;
  const steps = boxSize > 0 ? Math.round(Math.abs(bar.close - bar.open) / boxSize) : 0;
  const levels: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    levels.push(rising ? bar.open + step * boxSize : bar.open - step * boxSize);
  }
  return { rising, levels };
}
