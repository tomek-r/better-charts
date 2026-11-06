import {
  PriceScaleMode,
  type IChartApi,
  type IPriceScaleApi,
  type ISeriesApi,
  type SeriesType,
} from 'lightweight-charts';
import { setPriceScaleRange } from './priceScaleRange';

/** One pane as the chart lists it. Read it by index each time: the list shifts when a pane goes. */
export type ChartPane = ReturnType<IChartApi['panes']>[number];

/** The series a pane's prices are drawn from, whichever kind of series it is. */
export type PaneSeries = ISeriesApi<SeriesType>;

/** The mode a toggle asks for: the one the scale it belongs to is not drawn in now. */
export function otherModeOf(scale: IPriceScaleApi): PriceScaleMode {
  const logarithmic = scale.options().mode === PriceScaleMode.Logarithmic;
  return logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic;
}

/**
 * Writes one scale's mode, holding its manual range across the switch: the library writes a manual
 * range in the coordinates of the mode it was set in, so without this the range would land elsewhere.
 */
export function writeScaleMode(scale: IPriceScaleApi, series: PaneSeries | undefined, mode: PriceScaleMode): void {
  const range = scale.options().autoScale ? null : scale.getVisibleRange();
  scale.applyOptions({ mode });
  if (range !== null && series !== undefined) {
    setPriceScaleRange(series, range);
  }
}

/**
 * Whether a pane's own scale can go logarithmic: a scale already there can be switched back, and otherwise every
 * value the pane draws must be at or above zero, a zero being allowed since a volume pane holds one.
 */
export function scaleAllowsLogarithmic(scale: IPriceScaleApi, pane: ChartPane | undefined): boolean {
  if (scale.options().mode === PriceScaleMode.Logarithmic) {
    return true;
  }
  return (pane?.getSeries() ?? []).every(seriesAllowsLogarithmic);
}

/** Whether a series draws no value below zero, which a logarithmic scale needs of every point it holds. */
function seriesAllowsLogarithmic(series: PaneSeries): boolean {
  return series.data().every(valueAllowsLogarithmic);
}

/** A point carrying a value below zero rules the scale out; a point without one says nothing about it. */
function valueAllowsLogarithmic(point: unknown): boolean {
  return !isValuePoint(point) || point.value >= 0;
}

/** Whether a series point carries a value: a candle and a whitespace point carry a time only. */
function isValuePoint(point: unknown): point is { readonly value: number } {
  if (typeof point !== 'object' || point === null || !('value' in point)) {
    return false;
  }
  return typeof point.value === 'number';
}
