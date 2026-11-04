import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { barBodyWidth, deviceBarBox, strokeBodyOutline, type DevicePixelRatios } from '../barBodyWidth';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { volumeCandleColors } from './volumeCandleColors';
import { volumeCandleWidth, type VisibleVolumeRange } from './volumeCandleWidth';
import { VOLUME_CANDLES_DEFAULT_OPTIONS, type VolumeCandlesOptions } from './volumeCandlesOptions';
import type { VolumeCandlePoint } from './volumeCandlePoint';

/** One bar's prices as the media y the price scale places them at. */
interface PlottedPrices {
  readonly highY: number;
  readonly lowY: number;
  readonly openY: number;
  readonly closeY: number;
}

/** What every bar of one paint shares: the canvas, the options, the price scale and the window's volumes. */
interface VolumeCandlePaint extends DevicePixelRatios {
  readonly context: CanvasRenderingContext2D;
  readonly options: VolumeCandlesOptions;
  readonly priceConverter: PriceToCoordinateConverter;
  readonly visibleVolumes: VisibleVolumeRange;
  readonly fullWidth: number;
}

/** The range a window with no visible bar trades in, which draws every body at the full width. */
const NO_VISIBLE_VOLUME: VisibleVolumeRange = { min: 0, max: 0 };

/** The range the volumes of the visible bars span, which the widest and narrowest bodies are scaled to. */
function visibleVolumesOf(
  bars: readonly CustomBarItemData<Time, VolumeCandlePoint>[],
  visibleBars: VisibleBarIndices,
): VisibleVolumeRange {
  let quietestVolume = Number.POSITIVE_INFINITY;
  let busiestVolume = Number.NEGATIVE_INFINITY;
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = bars[index];
    if (bar !== undefined) {
      quietestVolume = Math.min(quietestVolume, bar.originalData.volume);
      busiestVolume = Math.max(busiestVolume, bar.originalData.volume);
    }
  }
  if (!Number.isFinite(quietestVolume)) {
    return NO_VISIBLE_VOLUME;
  }
  return { min: quietestVolume, max: busiestVolume };
}

/** One bar's prices as the media y the price scale places them at, or none when it can place none of them. */
function plottedPrices(point: VolumeCandlePoint, priceConverter: PriceToCoordinateConverter): PlottedPrices | null {
  const highY = priceConverter(point.high);
  const lowY = priceConverter(point.low);
  const openY = priceConverter(point.open);
  const closeY = priceConverter(point.close);
  if (highY === null || lowY === null || openY === null || closeY === null) {
    return null;
  }
  return { highY, lowY, openY, closeY };
}

/** Paints one bar's wick and body in the colours its candle settings gave it. */
function paintVolumeCandle(paint: VolumeCandlePaint, bar: CustomBarItemData<Time, VolumeCandlePoint>): void {
  const point = bar.originalData;
  const prices = plottedPrices(point, paint.priceConverter);
  if (prices === null) {
    return;
  }
  const { context, options, horizontalPixelRatio } = paint;
  const colors = volumeCandleColors(options, point);
  if (options.wickVisible) {
    const wickWidth = Math.max(1, Math.round(horizontalPixelRatio));
    const wick = deviceBarBox(bar.x, wickWidth, prices.highY, prices.lowY, paint);
    context.fillStyle = colors.wick;
    context.fillRect(wick.left, wick.top, wick.width, wick.height);
  }
  const bodyWidth = volumeCandleWidth(point.volume, paint.visibleVolumes, paint.fullWidth, options.widthSensitivity);
  const body = deviceBarBox(
    bar.x,
    bodyWidth,
    Math.min(prices.openY, prices.closeY),
    Math.max(prices.openY, prices.closeY),
    paint,
  );
  context.fillStyle = colors.body;
  context.fillRect(body.left, body.top, body.width, body.height);
  if (options.borderVisible) {
    context.strokeStyle = colors.border;
    strokeBodyOutline(context, body);
  }
}

/**
 * The custom series renderer of the volume candles: each bar is a candle whose body grows with its volume
 * across the range the visible bars trade in, so the busiest bar on screen fills the body width while the
 * quietest narrows by the width sensitivity the chart saved.
 */
export class VolumeCandlesRenderer extends CustomBarRenderer<VolumeCandlePoint, VolumeCandlesOptions> {
  protected override options: VolumeCandlesOptions = VOLUME_CANDLES_DEFAULT_OPTIONS;

  protected drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, VolumeCandlePoint>,
    visibleBars: VisibleBarIndices,
  ): void {
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const paint: VolumeCandlePaint = {
        context,
        options: this.options,
        priceConverter,
        visibleVolumes: visibleVolumesOf(data.bars, visibleBars),
        fullWidth: barBodyWidth(data.barSpacing, horizontalPixelRatio),
        horizontalPixelRatio,
        verticalPixelRatio,
      };
      context.save();
      for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
        const bar = data.bars[index];
        if (bar !== undefined) {
          paintVolumeCandle(paint, bar);
        }
      }
      context.restore();
    });
  }
}
