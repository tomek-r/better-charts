import {
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { DEFAULT_BAR_SPACING } from '../timeScale/futureTimePoints';
import { candleSeriesColors, DEFAULT_CANDLE_APPEARANCE } from '../bars/candleAppearance';
import { chartLayoutOptions, DEFAULT_CHART_APPEARANCE, priceScaleMargins } from './chartAppearance';

interface ChartSurface {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  future: ISeriesApi<'Line'>;
}

const FALLBACK_CHART_LOCALE = 'en-GB';

/**
 * The library's pane separator and its resize handle's hover band span both price-scale columns, so
 * both are hidden and each indicator pane paints its own top border across the pane only (see
 * IndicatorPaneOverlay). The handle still takes the pointer, so a pane can still be resized.
 */
const PANE_SEPARATOR_COLOR = 'transparent';

// Linux WebKitGTK reports navigator.language as 'C' under LANG=C, which is not a language
// tag: the library's toLocaleString(locale) throws on it and aborts the whole paint.
function chartLocale(): string {
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf(navigator.language).length > 0) {
      return navigator.language;
    }
  } catch {
    // supportedLocalesOf throws a RangeError on a malformed tag.
  }
  return FALLBACK_CHART_LOCALE;
}

/**
 * Builds the chart and the two series it owns. This is the only module that
 * creates the chart and its series, so the visual configuration lives here rather
 * than being spread through the controller: the hidden crosshair, the time scale's
 * end margin, and the separate price scale that keeps the helper points out of
 * the price fit.
 *
 * The chart's own paint — background, grids, scale text and borders, margins —
 * comes from `DEFAULT_CHART_APPEARANCE` through the mappers, which is the same
 * appearance the settings apply, so the first paint and every later setting agree.
 *
 * The controller keeps the handles and owns their lifecycle: attachment,
 * detachment and disposal.
 */
export function createChartSurface(host: HTMLElement): ChartSurface {
  const { layout, grid, rightPriceScale, timeScale } = chartLayoutOptions(DEFAULT_CHART_APPEARANCE);
  const chart = createChart(host, {
    autoSize: false,
    // This background is also the fill the A/L price-scale toggles mask the axis labels with; see
    // features/chart/engine/priceScale/price-scale-controls.css.
    layout: {
      ...layout,
      attributionLogo: false,
      panes: {
        separatorColor: PANE_SEPARATOR_COLOR,
        separatorHoverColor: PANE_SEPARATOR_COLOR,
      },
    },
    localization: { locale: chartLocale() },
    grid,
    crosshair: {
      mode: CrosshairMode.Hidden,
      vertLine: { visible: false, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    rightPriceScale: {
      ...rightPriceScale,
      minimumWidth: 70,
      scaleMargins: priceScaleMargins(DEFAULT_CHART_APPEARANCE),
      // Auto scale stays off: the range is fitted once per loaded series (see
      // fitPriceScale) and then holds, so a tick cannot rescale
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
      ...timeScale,
      timeVisible: true,
      secondsVisible: false,
      barSpacing: DEFAULT_BAR_SPACING,
      rightOffset: DEFAULT_CHART_APPEARANCE.rightMarginBars,
      lockVisibleTimeRangeOnResize: false,
      shiftVisibleRangeOnNewBar: false,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
  const candles = chart.addSeries(CandlestickSeries, {
    // The anchor is drawn with the same appearance the settings start from, so the first
    // paint and every later setting agree on what a candle looks like.
    ...candleSeriesColors(DEFAULT_CANDLE_APPEARANCE),
    priceLineVisible: false,
    lastValueVisible: false,
  });
  // Real-valued invisible points extend the time scale using public API. A
  // separate scale and null autoscale provider keep them out of price fits.
  const future = chart.addSeries(LineSeries, {
    priceScaleId: 'future',
    visible: false,
    priceLineVisible: false,
    lastValueVisible: false,
    autoscaleInfoProvider: () => null,
  });
  return { chart, candles, future };
}
