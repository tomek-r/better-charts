import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { DEFAULT_BAR_SPACING, END_MARGIN } from './futureTimePoints';
import { palette } from '../../../shared/theme/palette';

export interface ChartSurface {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  future: ISeriesApi<'Line'>;
}

/**
 * Builds the chart and the three series it owns. This is the only module that
 * creates the chart and its series, so the visual configuration lives here rather
 * than being spread through the controller: the palette, the hidden crosshair, the
 * time scale's end margin, and the separate price scales that keep the volume and
 * the helper points out of the price fit.
 *
 * The controller keeps the handles and owns their lifecycle: attachment,
 * detachment and disposal.
 */
export function createChartSurface(host: HTMLElement): ChartSurface {
  const chart = createChart(host, {
    autoSize: false,
    layout: {
      // This colour is also .price-scale-controls' fill in features/chart/chart.css,
      // which masks the axis labels behind the price-scale toggles.
      background: { type: ColorType.Solid, color: palette.overlay },
      textColor: palette.mutedStrong,
      fontSize: 11,
      attributionLogo: true,
    },
    grid: { vertLines: { color: palette.borderSubtle }, horzLines: { color: palette.borderSubtle } },
    crosshair: {
      mode: CrosshairMode.Hidden,
      vertLine: { visible: false, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    rightPriceScale: {
      borderColor: palette.border,
      minimumWidth: 70,
      scaleMargins: { top: 0.12, bottom: 0.18 },
      // Auto scale stays off: the range is fitted once per loaded series (see
      // ChartController.fitPriceScale) and then holds, so a tick cannot rescale
      // the pane under the pointer. `A`, a double-click on the axis and dragging
      // it are the ways back to a fitted range.
      autoScale: false,
      // Labels stay on their own price. The library's label alignment splits
      // its labels around the series' last price and pushes overlapping ones
      // apart, and that price alternates between the Bid and the Ask tick — so
      // with a spread inside one label height any pair near the price is
      // restacked on every tick and visibly flickers. The Bid/Ask tags are
      // positioned by the price-axis tags primitive instead, and the staged
      // and position tags stay where their prices are.
      alignLabels: false,
    },
    timeScale: {
      borderColor: palette.border,
      timeVisible: true,
      secondsVisible: false,
      barSpacing: DEFAULT_BAR_SPACING,
      rightOffset: END_MARGIN,
      lockVisibleTimeRangeOnResize: false,
      shiftVisibleRangeOnNewBar: false,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
  const candles = chart.addSeries(CandlestickSeries, {
    upColor: palette.up,
    downColor: palette.sell,
    borderVisible: false,
    wickUpColor: palette.up,
    wickDownColor: palette.sell,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    priceLineVisible: false,
    lastValueVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false });
  // Real-valued invisible points extend the time scale using public API. A
  // separate scale and null autoscale provider keep them out of price fits.
  const future = chart.addSeries(LineSeries, {
    priceScaleId: 'future',
    visible: false,
    priceLineVisible: false,
    lastValueVisible: false,
    autoscaleInfoProvider: () => null,
  });
  return { chart, candles, volume, future };
}
