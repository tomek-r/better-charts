import {
  MismatchDirection,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type LineData,
  type Logical,
  type LogicalRange,
  type PrimitivePaneViewZOrder,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { fillPolygons, type FillColumn, type FillPoint } from './indicatorFillPolygons';
import type { IndicatorFill, IndicatorFillEdge, IndicatorLevel } from './indicatorFrame';

/** A fill sits under the lines it belongs to, above nothing but the background. */
const FILL_VIEW_Z_ORDER: PrimitivePaneViewZOrder = 'bottom';

/** One bar past each edge of the viewport, so a band leaves the pane instead of stopping at its edge. */
const VIEWPORT_MARGIN_BARS = 1;

/** A bar the band cannot cross: it has no coordinate, so both edges are null and its `x` is never read. */
const BREAK_COLUMN: FillColumn = { x: 0, from: null, to: null };

/** One filled band, ready to paint. */
interface ColoredPolygon {
  readonly color: string;
  readonly points: readonly FillPoint[];
}

/**
 * Paints an indicator's fills: the bands between two plots, a plot and a level, or two levels.
 *
 * Attached to the indicator's first plot series, so it is clipped to the same pane and drawn in
 * the same coordinate space as the plots. It reads the series' own data on every draw rather than
 * caching values, because the layer updates one series at a time and the chart repaints after each.
 */
export class IndicatorFillPrimitive extends ChartSeriesPrimitive {
  private readonly views: readonly IPrimitivePaneView[];
  private hidden = false;

  constructor(
    private readonly plotSeries: readonly ISeriesApi<'Line'>[],
    private readonly levels: readonly IndicatorLevel[],
    private readonly fills: readonly IndicatorFill[],
  ) {
    super();
    // The view list is stable: the library caches views by array identity. A hidden fill
    // returns no renderer, so hiding costs no painting.
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => FILL_VIEW_Z_ORDER, renderer: () => (this.hidden ? null : renderer) }];
  }

  /** Follows the indicator's own hide/show; the layer calls this with the state of its series. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private draw(target: RenderTarget): void {
    const range = this.chart === null ? null : this.chart.timeScale().getVisibleLogicalRange();
    if (range === null) {
      return;
    }
    const polygons = this.polygonsIn(range);
    if (polygons.length === 0) {
      return;
    }
    target.useMediaCoordinateSpace(({ context }) => {
      for (const polygon of polygons) {
        paintPolygon(context, polygon);
      }
    });
  }

  /** Every band of every fill, cut at the bars where its edges are missing. */
  private polygonsIn(range: LogicalRange): ColoredPolygon[] {
    const indices = this.logicalIndices(range);
    const polygons: ColoredPolygon[] = [];
    for (const fill of this.fills) {
      polygons.push(...this.polygonsOf(fill, indices));
    }
    return polygons;
  }

  /** The bars a band can cover: the visible ones, widened by one bar on each side. */
  private logicalIndices(range: LogicalRange): number[] {
    const firstIndex = Math.max(0, Math.floor(range.from) - VIEWPORT_MARGIN_BARS);
    const lastIndex = Math.ceil(range.to) + VIEWPORT_MARGIN_BARS;
    const indices: number[] = [];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      indices.push(index);
    }
    return indices;
  }

  private polygonsOf(fill: IndicatorFill, indices: readonly number[]): ColoredPolygon[] {
    const columns = indices.map((index) => this.columnAt(fill, index));
    return fillPolygons(columns).map((points) => ({ color: fill.color, points }));
  }

  private columnAt(fill: IndicatorFill, index: number): FillColumn {
    const x = this.xAt(index);
    if (x === null) {
      return BREAK_COLUMN;
    }
    return { x, from: this.edgeAt(fill.from, index), to: this.edgeAt(fill.to, index) };
  }

  private xAt(index: number): number | null {
    return this.chart === null ? null : this.chart.timeScale().logicalToCoordinate(index as Logical);
  }

  /** The y of one end of a band at one bar, or null where that end has no price on the scale. */
  private edgeAt(edge: IndicatorFillEdge, index: number): number | null {
    const price = this.priceAt(edge, index);
    const scaleSeries = this.plotSeries[0];
    if (price === null || scaleSeries === undefined) {
      return null;
    }
    return scaleSeries.priceToCoordinate(price);
  }

  private priceAt(edge: IndicatorFillEdge, index: number): number | null {
    if (edge.kind === 'level') {
      const level = this.levels[edge.index];
      return level === undefined ? null : level.price;
    }
    const point = this.plotPointAt(edge.index, index);
    return point === null ? null : point.value;
  }

  /** The plot's point at one bar; null where that bar has no value or that plot does not exist. */
  private plotPointAt(plotIndex: number, index: number): LineData<Time> | null {
    const series = this.plotSeries[plotIndex];
    if (series === undefined) {
      return null;
    }
    const point: LineData<Time> | WhitespaceData<Time> | null = series.dataByIndex(index, MismatchDirection.None);
    if (point === null || !('value' in point)) {
      return null;
    }
    return point;
  }
}

/** Fills one band, leaving the context as it was for the next renderer. */
function paintPolygon(context: CanvasRenderingContext2D, polygon: ColoredPolygon): void {
  context.save();
  context.fillStyle = polygon.color;
  context.beginPath();
  tracePolygon(context, polygon.points);
  context.fill();
  context.restore();
}

function tracePolygon(context: CanvasRenderingContext2D, points: readonly FillPoint[]): void {
  const [first, ...rest] = points;
  if (first === undefined) {
    return;
  }
  context.moveTo(first.x, first.y);
  for (const point of rest) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}
