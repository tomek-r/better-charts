import { expect, type Page } from '@playwright/test';
import type { IndicatorPointState } from '../../src/features/chart/engine/indicators/indicatorPlotState';
import { CHART_HOST_SELECTOR } from './chartHost';
import { MILLISECONDS_PER_SECOND } from './indicatorBars';

/**
 * Where an indicator's plotted line is on the chart, for the specs that click it. The bar's x comes from
 * the chart's own coordinate conversion; the value's y comes from the price the pointer reports at two
 * pane heights, so a spec lands on the line without restating the scale's mode or its margins.
 */

/** The two pane heights the price scale is probed at: inside the pane, clear of the overlays at its top. */
const UPPER_PROBE_SHARE = 0.3;
const LOWER_PROBE_SHARE = 0.6;

/** The share of the host's width the probes and the empty click use: right of the legend, inside the plot. */
const PROBE_WIDTH_SHARE = 0.6;

/** How far below the pane's top edge the empty click lands: inside the scale's top margin, above every plot. */
const EMPTY_PANE_INSET_CSS_PX = 4;

/** How long the chart's frame may take to stop resizing, and how often its width is sampled meanwhile. */
const FRAME_SETTLE_TIMEOUT_MS = 5_000;
const FRAME_SETTLE_POLL_MS = 50;

/** A page point, in the client coordinates a click takes. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

/** The chart host on the page: its origin, and the width the probes and the empty click take a share of. */
interface ChartHostBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

async function measureChartHost(page: Page): Promise<ChartHostBox> {
  const box = await page.locator(CHART_HOST_SELECTOR).boundingBox();
  if (box === null) {
    throw new Error('The chart host has no box');
  }
  return { x: box.x, y: box.y, width: box.width };
}

/**
 * The host's box once its width has stopped changing. Opening a side drawer narrows the chart frame over
 * a 200 ms transition — the object tree's takes its whole 340 px off it — and a bar coordinate the chart
 * converted while its frame was still resizing sits right of where the bar lands, over that drawer, on
 * nothing. Two widths a poll apart make every point below wait for the resize to finish.
 */
async function chartHostBox(page: Page): Promise<ChartHostBox> {
  let box = await measureChartHost(page);
  let previousWidth: number | null = null;
  await expect
    .poll(
      async () => {
        const measured = await measureChartHost(page);
        const unchanged = measured.width === previousWidth;
        previousWidth = measured.width;
        box = measured;
        return unchanged;
      },
      { timeout: FRAME_SETTLE_TIMEOUT_MS, intervals: [FRAME_SETTLE_POLL_MS] },
    )
    .toBe(true);
  return box;
}

async function paneHeight(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.priceScale().paneHeight);
}

/** The price the pointer reports at `share` of the pane's height, and the pane y it was read at. */
async function pointerPrice(page: Page, host: ChartHostBox, share: number): Promise<{ y: number; price: number }> {
  const y = (await paneHeight(page)) * share;
  await page.mouse.move(host.x + host.width * PROBE_WIDTH_SHARE, host.y + y);
  const price = await page.evaluate(() => window.__chartTest?.pointerReadout()?.price ?? null);
  if (price === null) {
    throw new Error('The pointer reports no price over the pane');
  }
  return { y, price };
}

/** The pane y where `price` is drawn, worked out from the prices the pointer reports at two heights. */
async function paneYOfPrice(page: Page, host: ChartHostBox, price: number): Promise<number> {
  const upper = await pointerPrice(page, host, UPPER_PROBE_SHARE);
  const lower = await pointerPrice(page, host, LOWER_PROBE_SHARE);
  const slope = (lower.y - upper.y) / (lower.price - upper.price);
  return upper.y + (price - upper.price) * slope;
}

/** One drawn point of `instanceId`'s first plot, counting drawn points: its bar time and the value it plots. */
async function plottedPoint(page: Page, instanceId: string, pointIndex: number): Promise<IndicatorPointState> {
  const points = await page.evaluate((id) => {
    const indicator = window.__chartTest?.indicators().find((shown) => shown.id === id);
    return indicator?.plots[0]?.points ?? [];
  }, instanceId);
  const point = points[pointIndex];
  if (point === undefined) {
    throw new Error(`Indicator ${instanceId} draws no point ${pointIndex}`);
  }
  return point;
}

/** The page point where `instanceId`'s first plot draws its `pointIndex`-th point. */
export async function plotLinePoint(page: Page, instanceId: string, pointIndex: number): Promise<PagePoint> {
  const point = await plottedPoint(page, instanceId, pointIndex);
  const host = await chartHostBox(page);
  const x = await page.evaluate((timeMs) => {
    const x = window.__chartTest?.timeToX(timeMs);
    if (x === undefined || Number.isNaN(x)) {
      throw new Error('The plot point has no bar coordinate');
    }
    return x;
  }, point.time * MILLISECONDS_PER_SECOND);
  return { x: host.x + x, y: host.y + (await paneYOfPrice(page, host, point.value)) };
}

/** A page point the scale's top margin leaves empty, so a click there picks no plot. */
export async function emptyPanePoint(page: Page): Promise<PagePoint> {
  const host = await chartHostBox(page);
  return { x: host.x + host.width * PROBE_WIDTH_SHARE, y: host.y + EMPTY_PANE_INSET_CSS_PX };
}
