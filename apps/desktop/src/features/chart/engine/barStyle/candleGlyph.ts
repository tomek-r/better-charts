import type { PriceToCoordinateConverter } from 'lightweight-charts';
import { deviceBarBox, strokeBodyOutline, type DevicePixelRatios } from './barBodyWidth';

/** The four prices of one bar as the media y the price scale places them at. */
export interface CandlePrices {
  readonly highY: number;
  readonly lowY: number;
  readonly openY: number;
  readonly closeY: number;
}

/** The colours one candle is drawn in: its body, the outline of that body and its wick. */
export interface CandleGlyphColors {
  readonly body: string;
  readonly border: string;
  readonly wick: string;
}

/** What one candle is drawn with: its colours and the chart's own body, border and wick switches. */
export interface CandleGlyphStyle {
  readonly colors: CandleGlyphColors;
  readonly wickVisible: boolean;
  readonly borderVisible: boolean;
}

/** The four prices of the bar a custom series point carries. */
interface PricedBar {
  readonly high: number;
  readonly low: number;
  readonly open: number;
  readonly close: number;
}

/** The narrowest a wick is ever drawn, in device pixels. */
const WICK_DEVICE_WIDTH = 1;

/** One bar's prices as media y, or none when the price scale cannot place one of them. */
export function candlePrices(point: PricedBar, priceConverter: PriceToCoordinateConverter): CandlePrices | null {
  const highY = priceConverter(point.high);
  const lowY = priceConverter(point.low);
  const openY = priceConverter(point.open);
  const closeY = priceConverter(point.close);
  if (highY === null || lowY === null || openY === null || closeY === null) {
    return null;
  }
  return { highY, lowY, openY, closeY };
}

/** Paints one candle centred on `x`: its wick and its body `bodyWidthPx` device pixels wide. */
export function paintCandle(
  context: CanvasRenderingContext2D,
  x: number,
  bodyWidthPx: number,
  prices: CandlePrices,
  style: CandleGlyphStyle,
  ratios: DevicePixelRatios,
): void {
  if (style.wickVisible) {
    const wickWidth = Math.max(WICK_DEVICE_WIDTH, Math.round(ratios.horizontalPixelRatio));
    const wick = deviceBarBox(x, wickWidth, prices.highY, prices.lowY, ratios);
    context.fillStyle = style.colors.wick;
    context.fillRect(wick.left, wick.top, wick.width, wick.height);
  }
  const bodyTop = Math.min(prices.openY, prices.closeY);
  const bodyBottom = Math.max(prices.openY, prices.closeY);
  const body = deviceBarBox(x, bodyWidthPx, bodyTop, bodyBottom, ratios);
  context.fillStyle = style.colors.body;
  context.fillRect(body.left, body.top, body.width, body.height);
  if (style.borderVisible) {
    context.strokeStyle = style.colors.border;
    strokeBodyOutline(context, body);
  }
}
