import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type LogicalRange,
  type PrimitivePaneViewZOrder,
} from 'lightweight-charts';
import { ChartSeriesPrimitive } from '../surface/chartSeriesPrimitive';
import type { RenderTarget } from '../surface/drawTarget';
import { numericPointAt } from './indicatorSeriesValue';

/** Markers paint over their line, so a diamond stays readable where the line crosses it. */
const MARKER_VIEW_Z_ORDER: PrimitivePaneViewZOrder = 'top';

/** Width and height of a cross, circle or diamond, in CSS pixels. */
const MARKER_SIZE_CSS_PX = 7;

/** Outline width of every marker, in CSS pixels. */
const MARKER_STROKE_CSS_PX = 1;

/** A stem falls to price zero, the base the stem plots are scaled from. */
const STEM_BASE_PRICE = 0;

/** The arc that traces a circle once round. */
const FULL_CIRCLE_RADIANS = Math.PI * 2;

/** The shape a plot marks each of its points with. */
export type IndicatorMarkerShape = 'stem' | 'cross' | 'circle' | 'diamond';

/** A position in bitmap pixels. */
export interface MarkerPoint {
  readonly x: number;
  readonly y: number;
}

/** A stroke from one bitmap point to another. */
export interface MarkerSegment {
  readonly from: MarkerPoint;
  readonly to: MarkerPoint;
}

/** A circle stroked round its centre, in bitmap pixels. */
export interface MarkerCircle {
  readonly centre: MarkerPoint;
  readonly radius: number;
}

/** Half a marker's width in bitmap pixels, so a shape spans `MARKER_SIZE_CSS_PX` CSS pixels. */
export function markerHalfSize(pixelRatio: number): number {
  return (MARKER_SIZE_CSS_PX / 2) * pixelRatio;
}

/** A marker's outline in bitmap pixels, so it stays `MARKER_STROKE_CSS_PX` CSS pixels wide. */
export function markerStrokeWidth(pixelRatio: number): number {
  return MARKER_STROKE_CSS_PX * pixelRatio;
}

/** A stem: one vertical stroke from the point down to price zero. */
export function stemSegment(x: number, valueY: number, baseY: number): MarkerSegment {
  return { from: { x, y: valueY }, to: { x, y: baseY } };
}

/** A cross: one arm across the point, one arm down it. */
export function crossSegments(centre: MarkerPoint, halfSize: number): readonly MarkerSegment[] {
  const { top, right, bottom, left } = cornersOf(centre, halfSize);
  return [
    { from: left, to: right },
    { from: top, to: bottom },
  ];
}

/** A diamond: the four edges of a square turned on its corner. */
export function diamondSegments(centre: MarkerPoint, halfSize: number): readonly MarkerSegment[] {
  const { top, right, bottom, left } = cornersOf(centre, halfSize);
  return [
    { from: top, to: right },
    { from: right, to: bottom },
    { from: bottom, to: left },
    { from: left, to: top },
  ];
}

/** A circle whose diameter is the marker's width. */
export function markerCircle(centre: MarkerPoint, halfSize: number): MarkerCircle {
  return { centre, radius: halfSize };
}

/** The four points a marker's arms and edges end at. */
interface MarkerCorners {
  readonly top: MarkerPoint;
  readonly right: MarkerPoint;
  readonly bottom: MarkerPoint;
  readonly left: MarkerPoint;
}

function cornersOf(centre: MarkerPoint, halfSize: number): MarkerCorners {
  return {
    top: { x: centre.x, y: centre.y - halfSize },
    right: { x: centre.x + halfSize, y: centre.y },
    bottom: { x: centre.x, y: centre.y + halfSize },
    left: { x: centre.x - halfSize, y: centre.y },
  };
}

/** One marker to paint: its media coordinates and the colour the frame gave that point. */
interface PaintedMarker extends MarkerPoint {
  readonly color: string | undefined;
}

/**
 * Paints a plot's markers: one stem, cross, circle or diamond at every point its series holds.
 *
 * Attached to the plot's own line series, so the markers share its scale and pane. It reads the
 * series' data on every draw, like the fill primitive, because the layer updates one series at a
 * time and the chart repaints after each.
 */
export class IndicatorPlotMarkers extends ChartSeriesPrimitive {
  private readonly views: readonly IPrimitivePaneView[];

  constructor(
    readonly shape: IndicatorMarkerShape,
    private readonly color: string,
  ) {
    super();
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    // The view list is stable: the library caches views by array identity.
    this.views = [{ zOrder: () => MARKER_VIEW_Z_ORDER, renderer: () => renderer }];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** One marker per visible point; a hidden series paints nothing at all. */
  private draw(target: RenderTarget): void {
    const series = this.series;
    const range = this.chart?.timeScale().getVisibleLogicalRange() ?? null;
    if (series === null || range === null || !series.options().visible) {
      return;
    }
    const markers = this.markersIn(range);
    if (markers.length === 0) {
      return;
    }
    const baseY = this.shape === 'stem' ? series.priceToCoordinate(STEM_BASE_PRICE) : null;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const halfSize = markerHalfSize(horizontalPixelRatio);
      paintMarkers(context, markers, {
        shape: this.shape,
        color: this.color,
        halfSize,
        strokeWidth: markerStrokeWidth(horizontalPixelRatio),
        baseY: baseY === null ? null : baseY * verticalPixelRatio,
        horizontalPixelRatio,
        verticalPixelRatio,
      });
    });
  }

  /** Every point of the series inside the visible range that has a coordinate to draw at. */
  private markersIn(range: LogicalRange): PaintedMarker[] {
    const markers: PaintedMarker[] = [];
    for (let index = Math.max(0, Math.floor(range.from)); index <= Math.ceil(range.to); index += 1) {
      const marker = this.markerAt(index);
      if (marker !== null) {
        markers.push(marker);
      }
    }
    return markers;
  }

  private markerAt(index: number): PaintedMarker | null {
    const series = this.series;
    const x = this.chart === null ? null : this.chart.timeScale().logicalToCoordinate(index as Logical);
    if (series === null || x === null) {
      return null;
    }
    const point = numericPointAt(series, index);
    if (point === null) {
      return null;
    }
    const y = series.priceToCoordinate(point.value);
    if (y === null) {
      return null;
    }
    return { x, y, color: point.color };
  }
}

/** What every marker of one draw pass shares. */
interface MarkerPaint {
  readonly shape: IndicatorMarkerShape;
  readonly color: string;
  readonly halfSize: number;
  readonly strokeWidth: number;
  /** Bitmap y of price zero; only a stem reads it. */
  readonly baseY: number | null;
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

function paintMarkers(context: CanvasRenderingContext2D, markers: readonly PaintedMarker[], paint: MarkerPaint): void {
  context.save();
  context.lineWidth = paint.strokeWidth;
  for (const marker of markers) {
    context.strokeStyle = marker.color ?? paint.color;
    strokeMarker(context, paint, bitmapCentreOf(marker, paint));
  }
  context.restore();
}

function bitmapCentreOf(marker: MarkerPoint, paint: MarkerPaint): MarkerPoint {
  return { x: marker.x * paint.horizontalPixelRatio, y: marker.y * paint.verticalPixelRatio };
}

/** Strokes one marker at `centre`; a stem also needs the bitmap y of price zero. */
function strokeMarker(context: CanvasRenderingContext2D, paint: MarkerPaint, centre: MarkerPoint): void {
  const shape = paint.shape;
  if (shape === 'circle') {
    traceCircle(context, markerCircle(centre, paint.halfSize));
    return;
  }
  const segments = segmentsOf(shape, centre, paint.halfSize, paint.baseY);
  if (segments === null) {
    return;
  }
  context.beginPath();
  for (const segment of segments) {
    context.moveTo(segment.from.x, segment.from.y);
    context.lineTo(segment.to.x, segment.to.y);
  }
  context.stroke();
}

/** A stem without a zero coordinate has nowhere to fall, so it is left out. */
function segmentsOf(
  shape: 'stem' | 'cross' | 'diamond',
  centre: MarkerPoint,
  halfSize: number,
  baseY: number | null,
): readonly MarkerSegment[] | null {
  if (shape === 'cross') {
    return crossSegments(centre, halfSize);
  }
  if (shape === 'diamond') {
    return diamondSegments(centre, halfSize);
  }
  return baseY === null ? null : [stemSegment(centre.x, centre.y, baseY)];
}

function traceCircle(context: CanvasRenderingContext2D, circle: MarkerCircle): void {
  context.beginPath();
  context.arc(circle.centre.x, circle.centre.y, circle.radius, 0, FULL_CIRCLE_RADIANS);
  context.stroke();
}
