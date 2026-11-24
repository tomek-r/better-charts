import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { barBodyWidth, type DevicePixelRatios } from '../barBodyWidth';
import { candlePrices, paintCandle } from '../candleGlyph';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { volumeCandleColors } from './volumeCandleColors';
import { volumeCandleWidth, type VisibleVolumeRange } from './volumeCandleWidth';
import { VOLUME_CANDLES_DEFAULT_OPTIONS, type VolumeCandlesOptions } from './volumeCandlesOptions';
import type { VolumeCandlePoint } from './volumeCandlePoint';

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

/** Paints one bar's wick and body in the colours its candle settings gave it. */
function paintVolumeCandle(paint: VolumeCandlePaint, bar: CustomBarItemData<Time, VolumeCandlePoint>): void {
  const point = bar.originalData;
  const prices = candlePrices(point, paint.priceConverter);
  if (prices === null) {
    return;
  }
  const bodyWidth = volumeCandleWidth(
    point.volume,
    paint.visibleVolumes,
    paint.fullWidth,
    paint.options.widthSensitivity,
  );
  const style = {
    colors: volumeCandleColors(paint.options, point),
    wickVisible: paint.options.wickVisible,
    borderVisible: paint.options.borderVisible,
  };
  paintCandle(paint.context, bar.x, bodyWidth, prices, style, paint);
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
