import type { RenderBar } from './renderBar';

/** The bar facts the time scale is derived from; written by BarSeriesController. */
export interface TimeModel {
  readonly bars: readonly RenderBar[];
  readonly timeframe: string;
  readonly intervalSeconds: number;
  lastBar(): RenderBar | undefined;
}
