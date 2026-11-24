import type { ChartTypeBarsPort } from '../engine/bars/chartTypeBars';
import { chartTypeCandles } from './chartTypeCandles';
import { computeChartTypeBars } from './chartTypeCommands';
import { chartTypeSpecOf } from './chartTypeSpecs';

/**
 * The engine's chart-type port, answered by the backend: the candles the chart holds go to
 * `compute_chart_type_bars` with the spec the settings chose, and the bars it draws come back as candles the
 * chart can hold. Read-only — the command reads nothing but the candles it is given.
 */
export function createChartTypeBarsPort(): ChartTypeBarsPort {
  return {
    transform: (candles, appearance) =>
      computeChartTypeBars(candles, chartTypeSpecOf(appearance)).then(chartTypeCandles),
  };
}
