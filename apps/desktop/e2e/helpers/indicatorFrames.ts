import type { Page } from '@playwright/test';
import type { ChartIndicatorPane } from '../../src/features/chart/engine/indicators/indicatorContract';
import type { IndicatorFrame, IndicatorPlot } from '../../src/features/chart/engine/indicators/indicatorFrame';
import type { IndicatorLayerState } from '../../src/features/chart/engine/indicators/indicatorLayer';
import { openChart } from './openChart';
import { gotoWithStub } from './tauriStub';

/**
 * What the indicator specs hand to the dev hook and read back: the two plots and the id their tests
 * share, a frame built over the bars of the opened chart, and the layer's own report of what it drew.
 */

/** The id the demo indicator is drawn under. */
export const DEMO_ID = 'demo';
/** The two plots of the demo indicator: a plain line and a stepped one. */
export const FAST_PLOT: IndicatorPlot = { title: 'fast', style: 'line', color: '#2962ff', lineWidth: 2 };
export const SLOW_PLOT: IndicatorPlot = { title: 'slow', style: 'stepline', color: '#ff6d00', lineWidth: 1 };

/** A frame of `plots` over `times`, where `valueAt` says what plot `plotIndex` plots on bar `barIndex`. */
export function frameOf(
  plots: readonly IndicatorPlot[],
  times: readonly number[],
  valueAt: (plotIndex: number, barIndex: number) => number | null,
): IndicatorFrame {
  return {
    plots,
    bars: times.map((time, barIndex) => ({
      timeMs: time * 1000,
      confirmed: true,
      values: plots.map((_, plotIndex) => valueAt(plotIndex, barIndex)),
    })),
  };
}

/**
 * The opening every test shares: the stub page, the chart it opens, and the bar times that chart holds,
 * in the UTC seconds every point is keyed by.
 */
export async function openChartTimes(page: Page): Promise<number[]> {
  await gotoWithStub(page);
  await openChart(page);
  const bars = await page.evaluate(() => window.__chartTest!.data());
  return bars.map((bar) => bar.time);
}

/** Shows `frame` under `id`, in a pane of its own when `pane` says so. */
export async function showFrame(
  page: Page,
  id: string,
  frame: IndicatorFrame,
  pane?: ChartIndicatorPane,
): Promise<void> {
  await page.evaluate(({ id, frame, pane }) => window.__chartTest!.showIndicatorFrame(id, frame, pane), {
    id,
    frame,
    pane,
  });
}

/** Every indicator the display layer draws, in the order it was shown. */
export async function drawnIndicators(page: Page): Promise<IndicatorLayerState[]> {
  return page.evaluate(() => window.__chartTest!.indicators());
}

/** Removes everything the layer drew for `id`, and the pane it held. */
export async function removeIndicator(page: Page, id: string): Promise<void> {
  await page.evaluate((instanceId) => window.__chartTest!.removeIndicator(instanceId), id);
}

/** How many panes the chart has, the price pane included. */
export async function paneCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.paneCount());
}
