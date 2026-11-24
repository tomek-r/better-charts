import { invoke } from '@tauri-apps/api/core';
import type { BoxMethod } from '../engine/barStyle/boxMethod';
import type { PointFigureSource } from '../engine/barStyle/pointFigureSource';
import type { Candle } from '../../../shared/bridge/types';

/** How a box-sized chart type sizes the move that draws its next bar, which the settings declare. */
export type { BoxMethod };

/** Which prices a point & figure column reads, which the settings declare. */
export type { PointFigureSource };

/** The parameters every box-sized chart type carries; its method names the one that applies. */
export interface BoxParameters {
  /** Bars of Wilder's average true range; read by the `atr` method. */
  atrLength: number;
  /** Fixed price distance; read by the `traditional` method. */
  boxSize: string;
  /** Percent of the last close; read by the `percentageLtp` method. */
  percentage: string;
}

/** One chart type as the settings send it: one tagged shape per chart kind. */
export type ChartTypeSpec =
  | { type: 'heikinAshi' }
  | { type: 'lineBreak'; lines: number }
  | ({ type: 'renko'; boxMethod: BoxMethod; wicks: boolean } & BoxParameters)
  | { type: 'kagi'; reversalMethod: BoxMethod; atrLength: number; reversal: string; percentage: string }
  | ({ type: 'pointFigure'; source: PointFigureSource; boxMethod: BoxMethod; reversal: number } & BoxParameters);

/** One bar a chart type draws, with the decimal-string prices the chart parses. */
export interface ChartTypeBar {
  timeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * The bars `chart` draws from `candles`.
 *
 * Read-only: the candles are the chart's own, so a redraw on every settings change reaches no
 * broker. A price or a spec value that does not parse rejects the call instead of drawing a bar
 * the broker never sent.
 */
export function computeChartTypeBars(candles: readonly Candle[], chart: ChartTypeSpec): Promise<ChartTypeBar[]> {
  return invoke<ChartTypeBar[]>('compute_chart_type_bars', { candles, chart });
}
