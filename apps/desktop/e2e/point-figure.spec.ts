import { expect, test } from '@playwright/test';
import { chartTypeAppearanceOf } from '../src/features/chart/engine/barStyle/chartTypeAppearance';
import {
  pointFigureBoxSize,
  type PointFigureBar,
} from '../src/features/chart/engine/barStyle/pointFigure/pointFigureBox';
import {
  pointFigureColumn,
  type PointFigureColumn,
} from '../src/features/chart/engine/barStyle/pointFigure/pointFigureColumn';
import { barStyleAppearanceOf } from '../src/features/chart/chartSettings/barStyleAppearanceSetting';
import { chartTypeSpecOf } from '../src/features/chart/chartTypes/chartTypeSpecs';

/**
 * The Point & figure grid read back off the columns the backend draws: one box is the distance a reversal column
 * opened beyond the previous column's tip, and every column prints one X or O per box between its open and its
 * close. The prices are the decimal text the command writes, and a column prints the marks its own bar names.
 */

/** The columns `[open, close]` pairs name, as the grid is read off the bars the chart holds. */
function columnsOf(...pairs: [string, string][]): PointFigureBar[] {
  return pairs.map(([open, close]) => ({ open: Number(open), close: Number(close) }));
}

/** One column's levels at the precision its prices came from, so a level one box on compares whole. */
function levelsOf(column: PointFigureColumn): number[] {
  return column.levels.map((level) => Number(level.toFixed(6)));
}

test('the box size is the distance a reversal column opened beyond the previous column', () => {
  // Three columns on a 10-point box: every reversal opens exactly one box beyond the tip before it.
  const bars = columnsOf(['1.0850', '1.0880'], ['1.0870', '1.0850'], ['1.0860', '1.0890']);

  expect(pointFigureBoxSize(bars)).toBe(0.001);
});

test('the most columns that name one distance name the box', () => {
  // The first reversal runs a box and a half back; the two columns after it name the 10-point grid.
  const bars = columnsOf(['1.0850', '1.0880'], ['1.0865', '1.0840'], ['1.0850', '1.0870'], ['1.0860', '1.0885']);

  expect(pointFigureBoxSize(bars)).toBe(0.001);
});

test('a chart of one column sizes its boxes by that column', () => {
  // With no reversal to read, the column's own height stands in for the box, so its two ends are its two marks.
  const only = columnsOf(['10', '13']);
  const boxSize = pointFigureBoxSize(only);

  expect(boxSize).toBe(3);
  expect(levelsOf(pointFigureColumn({ open: 10, close: 13 }, boxSize))).toEqual([10, 13]);
  // Nothing to read at all leaves the renderer no box, which draws no mark.
  expect(pointFigureBoxSize([])).toBe(0);
  expect(pointFigureBoxSize(columnsOf(['10', '10']))).toBe(0);
});

test('a rising column prints one X per box from its open to its close, both included', () => {
  const column = pointFigureColumn({ open: 1.085, close: 1.088 }, 0.001);

  expect(column.rising).toBe(true);
  expect(levelsOf(column)).toEqual([1.085, 1.086, 1.087, 1.088]);
});

test('a falling column prints one O per box from its open down to its close', () => {
  const column = pointFigureColumn({ open: 1.087, close: 1.085 }, 0.001);

  expect(column.rising).toBe(false);
  expect(levelsOf(column)).toEqual([1.087, 1.086, 1.085]);
});

test('a column that closed where it opened prints the one mark of its box', () => {
  expect(pointFigureColumn({ open: 10, close: 10 }, 1)).toEqual({ rising: false, levels: [10] });
  // A column with no grid to step by still prints the mark of the box it opened at.
  expect(pointFigureColumn({ open: 10, close: 13 }, 0)).toEqual({ rising: true, levels: [10] });
});

test('the box the chart derives turns each column into the marks its grid holds', () => {
  const rising: PointFigureBar = { open: 1.085, close: 1.088 };
  const falling: PointFigureBar = { open: 1.087, close: 1.085 };
  const boxSize = pointFigureBoxSize([rising, falling]);

  expect(levelsOf(pointFigureColumn(rising, boxSize))).toEqual([1.085, 1.086, 1.087, 1.088]);
  expect(levelsOf(pointFigureColumn(falling, boxSize))).toEqual([1.087, 1.086, 1.085]);
});

test('the Point & figure defaults map onto the spec the command reads, its marks at TradingView own', () => {
  const appearance = chartTypeAppearanceOf(barStyleAppearanceOf('pointFigure', {}));
  if (appearance === null) {
    throw new Error('pointFigure is not a chart type');
  }

  expect(appearance).toMatchObject({ upColor: '#26a69a', downColor: '#ef5350' });
  expect(chartTypeSpecOf(appearance)).toEqual({
    type: 'pointFigure',
    source: 'highLow',
    boxMethod: 'atr',
    atrLength: 14,
    boxSize: '1',
    percentage: '1',
    reversal: 3,
  });
});
