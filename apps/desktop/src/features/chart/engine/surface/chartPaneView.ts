import type { IChartApi } from 'lightweight-charts';
import type { PriceScaleController } from '../priceScale/priceScaleController';
import type { ViewportController } from '../viewport/viewportController';

/**
 * Sizes the chart to its host and re-measures the pane the tools hit-test against. The native resize retains
 * bar spacing and right offset, and forcing a paint updates pane dimensions before the helper time series is
 * extended; the crosshair tool rejects pointer positions outside the pane, so the bounds are measured here
 * rather than waiting for the next overlay paint.
 */
export function sizeChartToHost(chart: IChartApi, host: HTMLElement, view: ViewportController): void {
  const spacing = chart.timeScale().options().barSpacing;
  const { width, height } = host.getBoundingClientRect();
  chart.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)), true);
  view.measurePane();
  view.ensureFuture(spacing);
}

/**
 * Puts the pane back to the end anchor. The reset fits the scale to the data it now shows (see `resetToEnd`)
 * but leaves the auto scale option where the user put it: it also runs on every selection change, and a scale
 * that started following each tick there would rescale the pane under the pointer. `resetChartView` is the
 * reset the user asks for.
 */
export function resetPaneToEnd(view: ViewportController, scaleControls: PriceScaleController): void {
  view.resetToEnd();
  view.clearRetainedPrices();
  scaleControls.sync();
}
