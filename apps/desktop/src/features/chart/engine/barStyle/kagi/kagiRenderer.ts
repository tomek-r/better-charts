import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import type { DevicePixelRatios } from '../barBodyWidth';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { KAGI_DEFAULT_OPTIONS, kagiStylePaint, type KagiOptions } from './kagiOptions';
import type { KagiPoint } from './kagiPoint';
import { kagiStrokes, openingStyleOf, type KagiStroke, type KagiStrokeStyle } from './kagiStrokes';

/** One straight piece of the line, in media pixels: where it runs and the style it is drawn in. */
interface KagiSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly style: KagiStrokeStyle;
}

/** The thinnest a stroke can be drawn, so a one-pixel yin line never falls below a device pixel. */
const ONE_DEVICE_PIXEL = 1;

/** The pieces one stroke draws: the horizontal that joins it to the stroke before it, then its own line. */
function strokeSegments(
  index: number,
  bar: CustomBarItemData<Time, KagiPoint>,
  stroke: KagiStroke,
  barSpacing: number,
  priceConverter: PriceToCoordinateConverter,
): KagiSegment[] {
  const openY = priceConverter(stroke.open);
  const closeY = priceConverter(stroke.close);
  if (openY === null || closeY === null) {
    return [];
  }
  const segments: KagiSegment[] = [];
  const openStyle = openingStyleOf(stroke);
  if (index > 0) {
    // Two strokes turn at the price the later one opens at, which a horizontal one bar slot long runs along.
    segments.push({ x1: bar.x - barSpacing, y1: openY, x2: bar.x, y2: openY, style: openStyle });
  }
  const brokenY = stroke.brokenLevel === null ? null : priceConverter(stroke.brokenLevel);
  if (brokenY === null) {
    segments.push({ x1: bar.x, y1: openY, x2: bar.x, y2: closeY, style: stroke.style });
    return segments;
  }
  segments.push({ x1: bar.x, y1: openY, x2: bar.x, y2: brokenY, style: openStyle });
  segments.push({ x1: bar.x, y1: brokenY, x2: bar.x, y2: closeY, style: stroke.style });
  return segments;
}

/** The visible bars as the pieces the line draws, in the bars' own order. */
function kagiSegments(
  data: PaneRendererCustomData<Time, KagiPoint>,
  strokes: readonly KagiStroke[],
  visibleBars: VisibleBarIndices,
  priceConverter: PriceToCoordinateConverter,
): KagiSegment[] {
  const segments: KagiSegment[] = [];
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = data.bars[index];
    const stroke = strokes[index];
    if (bar !== undefined && stroke !== undefined) {
      segments.push(...strokeSegments(index, bar, stroke, data.barSpacing, priceConverter));
    }
  }
  return segments;
}

/** A stroke's centre on the device grid: an odd thickness sits on a half pixel, so both its edges land whole. */
function crispCentre(mediaValue: number, pixelRatio: number, deviceWidth: number): number {
  const scaled = mediaValue * pixelRatio;
  return deviceWidth % 2 === 0 ? Math.round(scaled) : Math.floor(scaled) + 0.5;
}

/** Paints one piece, scaled by the pixel ratio across its own direction: a vertical is as wide as its line. */
function paintSegment(
  context: CanvasRenderingContext2D,
  options: KagiOptions,
  segment: KagiSegment,
  ratios: DevicePixelRatios,
): void {
  const vertical = segment.x1 === segment.x2;
  const paint = kagiStylePaint(options, segment.style);
  const across = vertical ? ratios.horizontalPixelRatio : ratios.verticalPixelRatio;
  const width = Math.max(ONE_DEVICE_PIXEL, Math.round(paint.width * across));
  context.strokeStyle = paint.color;
  context.lineWidth = width;
  context.beginPath();
  if (vertical) {
    const x = crispCentre(segment.x1, ratios.horizontalPixelRatio, width);
    context.moveTo(x, segment.y1 * ratios.verticalPixelRatio);
    context.lineTo(x, segment.y2 * ratios.verticalPixelRatio);
  } else {
    const y = crispCentre(segment.y1, ratios.verticalPixelRatio, width);
    context.moveTo(segment.x1 * ratios.horizontalPixelRatio, y);
    context.lineTo(segment.x2 * ratios.horizontalPixelRatio, y);
  }
  context.stroke();
}

/**
 * The custom series renderer of the Kagi line: one continuous stepped line, each bar a vertical stroke from its
 * open to its close in the bar's slot, joined to the stroke before it by a horizontal one slot long at the
 * turning price, drawn thick yang where the line broke a shoulder and thin yin where it broke a waist.
 */
export class KagiRenderer extends CustomBarRenderer<KagiPoint, KagiOptions> {
  protected override options: KagiOptions = KAGI_DEFAULT_OPTIONS;

  protected drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, KagiPoint>,
    visibleBars: VisibleBarIndices,
  ): void {
    // A stroke's style follows from every stroke before it, so the whole line is segmented once per paint.
    const strokes = kagiStrokes(data.bars.map((bar) => bar.originalData));
    const segments = kagiSegments(data, strokes, visibleBars, priceConverter);
    if (segments.length === 0) {
      return;
    }
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save();
      const ratios: DevicePixelRatios = { horizontalPixelRatio, verticalPixelRatio };
      for (const segment of segments) {
        paintSegment(context, this.options, segment, ratios);
      }
      context.restore();
    });
  }
}
