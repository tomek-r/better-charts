import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type LogicalRange,
  type PrimitivePaneViewZOrder,
} from 'lightweight-charts';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { fillPolygons, type FillColumn, type FillPoint } from './indicatorFillPolygons';
import type { IndicatorFill, IndicatorFillEdge, IndicatorLevel } from './indicatorFrame';
import type { IndicatorPlotSeries } from './indicatorPlotStyles';
import { numericPointAt } from './indicatorSeriesValue';

/** A fill sits under the lines it belongs to, above nothing but the background. */
const FILL_VIEW_Z_ORDER: PrimitivePaneViewZOrder = 'bottom';

/** One bar past each edge of the viewport, so a band leaves the pane instead of stopping at its edge. */
const VIEWPORT_MARGIN_BARS = 1;

/** A bar the band cannot cross: it has no coordinate, so both edges are null and its `x` is never read. */
const BREAK_COLUMN: FillColumn = { x: 0, from: null, to: null };

/** One filled run of per-bar columns, ready to paint. */
interface ColoredPolygon {
  readonly color: string;
  readonly points: readonly FillPoint[];
}

/** One band between two levels, painted as a single rectangle from the pane's left edge across its width. */
interface ColoredBand {
  readonly color: string;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

/** A fill with a level at both ends, whose band no bar can break. */
interface LevelFill {
  readonly from: { readonly kind: 'level'; readonly index: number };
  readonly to: { readonly kind: 'level'; readonly index: number };
  readonly color: string;
}

/**
 * Paints an indicator's fills: the bands between two plots, a plot and a level, or two levels.
 *
 * A fill between two levels is one rectangle from the pane's left edge to the price axis, as
 * TradingView draws a Pine `fill` of two `hline`s: it covers the whole pane, wherever the
 * indicator's bars begin and end. Every other fill follows the bars it can draw.
 *
 * Attached to the indicator's first plot series, so it is clipped to the same pane and drawn in
 * the same coordinate space as the plots. It reads the series' own data on every draw rather than
 * caching values, because the layer updates one series at a time and the chart repaints after each.
 */
export class IndicatorFillPrimitive extends ChartSeriesPrimitive {
  private readonly views: readonly IPrimitivePaneView[];
  private hidden = false;

  constructor(
    private readonly plotSeries: readonly IndicatorPlotSeries[],
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
    const bands = this.bandsInPane();
    const polygons = this.polygonsIn(range);
    if (bands.length === 0 && polygons.length === 0) {
      return;
    }
    target.useMediaCoordinateSpace(({ context }) => {
      for (const band of bands) {
        paintBand(context, band);
      }
      for (const polygon of polygons) {
        paintPolygon(context, polygon);
      }
    });
  }

  /** Every fill whose two edges are levels: one band across the pane, whatever bars the frame holds. */
  private bandsInPane(): ColoredBand[] {
    const width = this.chart === null ? 0 : this.chart.timeScale().width();
    if (width <= 0) {
      return [];
    }
    const bands: ColoredBand[] = [];
    for (const fill of this.fills) {
      if (!isLevelFill(fill)) {
        continue;
      }
      const band = this.bandOf(fill, width);
      if (band !== null) {
        bands.push(band);
      }
    }
    return bands;
  }

  /** One level fill's band in the pane's pixels; null while the pane's scale cannot place one of its levels. */
  private bandOf({ from, to, color }: LevelFill, width: number): ColoredBand | null {
    const fromY = this.levelYAt(from.index);
    const toY = this.levelYAt(to.index);
    if (fromY === null || toY === null) {
      return null;
    }
    return { color, top: Math.min(fromY, toY), bottom: Math.max(fromY, toY), width };
  }

  /** The y one of the frame's levels sits at; null when the frame has no such level or the scale no coordinate. */
  private levelYAt(levelIndex: number): number | null {
    const price = this.levelPrice(levelIndex);
    return price === null ? null : this.coordinateAt(price);
  }

  /** Every band of every fill that follows the bars, cut at the bars where its edges are missing. */
  private polygonsIn(range: LogicalRange): ColoredPolygon[] {
    const indices = this.logicalIndices(range);
    const polygons: ColoredPolygon[] = [];
    for (const fill of this.fills) {
      if (isLevelFill(fill)) {
        continue;
      }
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
    return price === null ? null : this.coordinateAt(price);
  }

  /** The y of a price on the pane's scale; null when no plot series carries that scale. */
  private coordinateAt(price: number): number | null {
    const scaleSeries = this.plotSeries[0];
    return scaleSeries === undefined ? null : scaleSeries.priceToCoordinate(price);
  }

  private priceAt(edge: IndicatorFillEdge, index: number): number | null {
    if (edge.kind === 'level') {
      return this.levelPrice(edge.index);
    }
    return this.plotValueAt(edge.index, index);
  }

  /** The price one of the frame's levels draws; null when the frame has no such level. */
  private levelPrice(levelIndex: number): number | null {
    const level = this.levels[levelIndex];
    return level === undefined ? null : level.price;
  }

  /** The plot's value at one bar; null where that bar has no value or that plot does not exist. */
  private plotValueAt(plotIndex: number, index: number): number | null {
    const series = this.plotSeries[plotIndex];
    if (series === undefined) {
      return null;
    }
    const point = numericPointAt(series, index);
    return point === null ? null : point.value;
  }
}

/** Whether levels end both edges of `fill`, which makes its band the same height at every bar. */
function isLevelFill(fill: IndicatorFill): fill is LevelFill {
  return fill.from.kind === 'level' && fill.to.kind === 'level';
}

/** Fills one band across the pane from its left edge, leaving the context as it was for the next renderer. */
function paintBand(context: CanvasRenderingContext2D, band: ColoredBand): void {
  context.save();
  context.fillStyle = band.color;
  context.fillRect(0, band.top, band.width, band.bottom - band.top);
  context.restore();
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
