import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { barBodyWidth, deviceBarBox, strokeBodyOutline, type DevicePixelRatios } from '../barBodyWidth';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { volumeCandleColors } from './volumeCandleColors';
import { volumeCandleWidth } from './volumeCandleWidth';
import { VOLUME_CANDLES_DEFAULT_OPTIONS, type VolumeCandlesOptions } from './volumeCandlesOptions';
import type { VolumeCandlePoint } from './volumeCandlePoint';

/** One bar's prices as the media y the price scale places them at. */
interface PlottedPrices {
  readonly highY: number;
  readonly lowY: number;
  readonly openY: number;
  readonly closeY: number;
}

/** What every bar of one paint shares: the canvas, the options, the price scale and the window's widest body. */
interface VolumeCandlePaint extends DevicePixelRatios {
  readonly context: CanvasRenderingContext2D;
  readonly options: VolumeCandlesOptions;
  readonly priceConverter: PriceToCoordinateConverter;
  readonly maximumVolume: number;
  readonly fullWidth: number;
}

/** The largest volume among the visible bars, which the widest body is scaled to. */
function maximumVolumeOf(
  bars: readonly CustomBarItemData<Time, VolumeCandlePoint>[],
  visibleBars: VisibleBarIndices,
): number {
  let maximumVolume = 0;
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = bars[index];
    if (bar !== undefined) {
      maximumVolume = Math.max(maximumVolume, bar.originalData.volume);
    }
  }
  return maximumVolume;
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
  const bodyWidth = volumeCandleWidth(point.volume, paint.maximumVolume, paint.fullWidth);
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
 * against the largest volume in the visible window, so the busiest bar on screen fills the body width.
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
        maximumVolume: maximumVolumeOf(data.bars, visibleBars),
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
