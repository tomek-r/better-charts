import type { PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { barBodyWidth, type DevicePixelRatios } from '../barBodyWidth';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { pointFigureBoxSize, type PointFigureBar } from './pointFigureBox';
import { pointFigureColumn } from './pointFigureColumn';
import { POINT_FIGURE_DEFAULT_OPTIONS, type PointFigureOptions } from './pointFigureOptions';
import type { PointFigurePoint } from './pointFigurePoint';

/** The thickness every mark is stroked at, in device pixels, and the smallest cell a mark is drawn in. */
const MARK_STROKE = 1;

/** Half a device pixel, which a one-pixel stroke sits on so it covers whole pixels. */
const HALF_DEVICE_PIXEL = 0.5;

/** A whole turn in radians, which closes a mark drawn as a circle. */
const WHOLE_TURN = Math.PI * 2;

/** One mark, in device pixels: the cell it fills, centred on its column's slot. */
interface MarkCell {
  readonly centreX: number;
  readonly centreY: number;
  readonly side: number;
}

/** One column as it is painted, in media pixels: its slot's centre, one box's height and its marks' heights. */
interface ColumnGeometry {
  readonly x: number;
  readonly boxHeight: number;
  readonly rising: boolean;
  readonly markYs: readonly number[];
}

/**
 * One column, or null when the price scale cannot place its grid. One box's height comes from the grid step
 * measured at the column's open rather than from two of its marks, because a column that fills a single box has
 * no second mark to measure by.
 */
function columnGeometry(
  x: number,
  bar: PointFigureBar,
  barSpacing: number,
  boxSize: number,
  priceConverter: PriceToCoordinateConverter,
): ColumnGeometry | null {
  const column = pointFigureColumn(bar, boxSize);
  const openY = priceConverter(bar.open);
  const nextY = priceConverter(bar.open + (column.rising ? boxSize : -boxSize));
  if (openY === null || nextY === null) {
    return null;
  }
  const markYs: number[] = [];
  for (const level of column.levels) {
    const y = priceConverter(level);
    if (y !== null) {
      markYs.push(y);
    }
  }
  if (markYs.length === 0) {
    return null;
  }
  // A chart whose columns carry no grid to read draws square marks, as wide as its slot.
  const boxHeight = boxSize > 0 ? Math.abs(nextY - openY) : barSpacing;
  return { x, boxHeight, rising: column.rising, markYs };
}

/** The visible columns the price scale can place, in the bars' own order. */
function columnGeometries(
  data: PaneRendererCustomData<Time, PointFigurePoint>,
  visibleBars: VisibleBarIndices,
  boxSize: number,
  priceConverter: PriceToCoordinateConverter,
): ColumnGeometry[] {
  const columns: ColumnGeometry[] = [];
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = data.bars[index];
    if (bar === undefined) {
      continue;
    }
    const geometry = columnGeometry(bar.x, bar.originalData, data.barSpacing, boxSize, priceConverter);
    if (geometry !== null) {
      columns.push(geometry);
    }
  }
  return columns;
}

/** Paints one X: two diagonals across the cell, inset by half a stroke so they stay inside it. */
function paintCross(context: CanvasRenderingContext2D, cell: MarkCell): void {
  const reach = Math.max(HALF_DEVICE_PIXEL, cell.side / 2 - HALF_DEVICE_PIXEL);
  const left = cell.centreX - reach;
  const right = cell.centreX + reach;
  const top = cell.centreY - reach;
  const bottom = cell.centreY + reach;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(right, bottom);
  context.moveTo(right, top);
  context.lineTo(left, bottom);
  context.stroke();
}

/** Paints one O: a circle filling the cell, inset by half a stroke so it stays inside it. */
function paintCircle(context: CanvasRenderingContext2D, cell: MarkCell): void {
  const radius = Math.max(HALF_DEVICE_PIXEL, cell.side / 2 - HALF_DEVICE_PIXEL);
  context.beginPath();
  context.arc(cell.centreX, cell.centreY, radius, 0, WHOLE_TURN);
  context.stroke();
}

/**
 * Paints one column's marks in the colour of its direction: a cell as wide as the slot and as tall as one box,
 * whichever is smaller, so a stack of marks reads as the grid the column was drawn on.
 */
function paintColumn(
  context: CanvasRenderingContext2D,
  options: PointFigureOptions,
  column: ColumnGeometry,
  slotWidth: number,
  ratios: DevicePixelRatios,
): void {
  const boxSide = Math.round(column.boxHeight * ratios.verticalPixelRatio);
  const side = Math.max(MARK_STROKE, Math.min(slotWidth, boxSide));
  const centreX = Math.round(column.x * ratios.horizontalPixelRatio);
  context.strokeStyle = column.rising ? options.upColor : options.downColor;
  for (const y of column.markYs) {
    const cell: MarkCell = { centreX, centreY: Math.round(y * ratios.verticalPixelRatio), side };
    if (column.rising) {
      paintCross(context, cell);
    } else {
      paintCircle(context, cell);
    }
  }
}

/**
 * The custom series renderer of the Point & figure columns: one bar slot per column, holding a stack of X marks
 * for a rising column and of O marks for a falling one, one mark per box from the column's open to its close.
 */
export class PointFigureRenderer extends CustomBarRenderer<PointFigurePoint, PointFigureOptions> {
  protected override options: PointFigureOptions = POINT_FIGURE_DEFAULT_OPTIONS;

  protected drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, PointFigurePoint>,
    visibleBars: VisibleBarIndices,
  ): void {
    // The box grid belongs to the whole chart, not to the window on screen: every column opens one box beyond the
    // tip before it, and the grid is the distance the most of them name.
    const boxSize = pointFigureBoxSize(data.bars.map((bar) => bar.originalData));
    const columns = columnGeometries(data, visibleBars, boxSize, priceConverter);
    if (columns.length === 0) {
      return;
    }
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save();
      context.lineWidth = MARK_STROKE;
      const ratios: DevicePixelRatios = { horizontalPixelRatio, verticalPixelRatio };
      const slotWidth = barBodyWidth(data.barSpacing, horizontalPixelRatio);
      for (const column of columns) {
        paintColumn(context, this.options, column, slotWidth, ratios);
      }
      context.restore();
    });
  }
}
