import { expect, test, type JSHandle, type Locator, type Page } from '@playwright/test';
import type { IndicatorFrame, IndicatorPlot } from '../src/features/chart/engine/indicators/indicatorFrame';
import { DEMO_ID, frameOf, openChartTimes, showFrame } from './helpers/indicatorFrames';
import { waitTwoAnimationFrames } from './helpers/animationFrames';
import { failOnPageNoise } from './helpers/pageNoise';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * One `A` / `L` row per pane: the price pane's own row at the foot of the price axis and above the
 * indicator panes, then one row at the foot of each indicator pane's own axis (see
 * src/features/chart/engine/priceScale/priceScaleController.ts). The rows are DOM buttons revealed by
 * a pointer hit test over the axis column they belong to, so these tests drive REAL pointer positions
 * against the chart host and read each pane's scale back through the DEV `window.__chartTest` hook.
 *
 * The indicator panes are attached through that hook, not through the saved-settings path of
 * e2e/helpers/savedIndicators.ts: this spec is about where a pane's row sits and what its buttons
 * write, not about what is saved.
 */

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface PaneRow extends Box {
  label: string | null;
}

interface ChartLayout {
  host: Box;
  axisWidth: number;
  priceBottom: number;
  indicatorBottom: number;
  rows: PaneRow[];
}

interface PaneScale {
  autoScale: boolean;
  logarithmic: boolean;
  lowestVisiblePrice: number | null;
}

const PRICE_ROW = 'Price scale';
const INDICATOR_ROW = 'Indicator price scale';
const INDICATOR_AUTO = 'Auto scale — fit this pane';
const INDICATOR_LOG = 'Logarithmic scale for this pane';
const PRICE_PANE = 0;
const INDICATOR_PANE = 1;
const STUB_BARS = 10;
const REVEALED = /price-scale-controls-revealed/;
/** Deep inside the axis column: a scale that shows labels is wider than this. */
const AXIS_INSET = 4;
/** How far above its pane's bottom a row may sit, in px — the allowance the single-pane spec uses. */
const ROW_OFFSET_LIMIT = 40;
/** Slack for the pane separator and for the sub-pixel rounding of the rows' inline placement. */
const PLACEMENT_SLACK = 2;
/** The stepped plot the anchored cases draw, and the same plot without the anchor as the counter-case. */
const STEP_PLOT: IndicatorPlot = { title: 'step', style: 'stepline', color: '#2962ff', lineWidth: 1 };
const ANCHORED_STEP_PLOT: IndicatorPlot = { ...STEP_PLOT, scaleFromZero: true };
/** The stepped plot's values run from 500 to 600, so every one of them sits far above price zero. */
const STEP_VALUE_START = 500;
const STEP_VALUE_END = 600;
/** Values that dip below zero, which a logarithmic scale cannot draw. */
const NEGATIVE_VALUE_START = -50;
/** The title the `L` button carries while its pane holds a value below zero. */
const LOG_NEEDS_POSITIVE_VALUES = 'Logarithmic scale needs values above zero';
/** A plot-area probe this far below the pane seam is inside the indicator pane, clear of its axis. */
const PLOT_PROBE_INSET = 20;
/** A second plot-area probe point, one step away from the warm-up one. */
const PLOT_PROBE_STEP = 12;
/** How much shorter the viewport gets, so every pane and its row move up the page. */
const VIEWPORT_HEIGHT_STEP = 120;

failOnPageNoise();

/** The instance id this spec attaches an indicator under, so the detach case can name it again. */
function paneInstanceId(definitionId: string): string {
  return `pane-${definitionId}`;
}

/** Opens the app with one own-pane indicator attached, so the chart has a price pane and an indicator pane. */
async function openWithIndicatorPane(page: Page, definitionId: string): Promise<void> {
  await gotoWithStub(page);
  await expect
    .poll(async () => page.evaluate(() => window.__chartTest!.data().length), { timeout: 10_000 })
    .toBe(STUB_BARS);
  const attached = await page.evaluate((ids) => window.__chartTest!.attachIndicator(ids.instance, ids.definition), {
    instance: paneInstanceId(definitionId),
    definition: definitionId,
  });
  expect(attached).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__chartTest!.paneCount())).toBe(2);
  // The row of the new pane is created from the panes' layout, which lands a frame after the pane does.
  await expect.poll(async () => page.locator('.price-scale-controls').count()).toBe(2);
}

/**
 * The host, the geometry of both panes and every row, measured in ONE task: the rows are placed from
 * that geometry, so reading them apart would let a layout land between the two reads.
 */
async function chartLayout(page: Page): Promise<ChartLayout> {
  return page.evaluate(() => {
    const boxOf = (element: Element): Box => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const hook = window.__chartTest;
    const host = document.querySelector('.chart-host');
    if (!hook || !host) {
      throw new Error('chart test hook or host is missing');
    }
    const hostBox = boxOf(host);
    const scale = hook.priceScale();
    const rows = Array.from(document.querySelectorAll('.price-scale-controls')).map((row) => ({
      label: row.getAttribute('aria-label'),
      ...boxOf(row),
    }));
    return {
      host: hostBox,
      axisWidth: scale.axisWidth,
      priceBottom: hostBox.top + scale.paneHeight,
      indicatorBottom: hostBox.bottom - scale.timeAxisHeight,
      rows,
    };
  });
}

function rowAt(layout: ChartLayout, label: string): PaneRow {
  const row = layout.rows.find((candidate) => candidate.label === label);
  if (!row) {
    throw new Error(`no price-scale row labelled ${label}`);
  }
  return row;
}

/** One pane's row, matched on its group name alone: the indicator row's name contains the price row's. */
function paneRow(page: Page, label: string): Locator {
  return page.getByRole('group', { name: label, exact: true });
}

/** Proves `row` sits at the foot of the pane whose bottom edge is `paneBottom` pixels down the page. */
function expectRowAtPaneFoot(row: PaneRow, paneBottom: number): void {
  expect(row.bottom).toBeGreaterThan(paneBottom - ROW_OFFSET_LIMIT);
  expect(row.bottom).toBeLessThanOrEqual(paneBottom + PLACEMENT_SLACK);
}

async function paneScaleAt(page: Page, paneIndex: number): Promise<PaneScale> {
  const scale = await page.evaluate((index) => window.__chartTest!.paneScale(index), paneIndex);
  if (scale === null) {
    throw new Error(`pane ${paneIndex} has no right price scale`);
  }
  return scale;
}

/** Puts the pointer inside one pane's axis column, halfway down that pane and clear of its row. */
async function hoverAxis(page: Page, layout: ChartLayout, pane: 'price' | 'indicator'): Promise<void> {
  const top = pane === 'price' ? layout.host.top : layout.priceBottom;
  const bottom = pane === 'price' ? layout.priceBottom : layout.indicatorBottom;
  await page.mouse.move(layout.host.right - AXIS_INSET, (top + bottom) / 2);
}

/**
 * Presses one of the indicator row's buttons and proves it flipped that pane's scale alone: the price
 * pane's scale is untouched, and the button's pressed state followed the scale.
 */
async function expectOnlyIndicatorPaneFlips(
  page: Page,
  button: Locator,
  read: (scale: PaneScale) => boolean,
): Promise<void> {
  const indicatorBefore = read(await paneScaleAt(page, INDICATOR_PANE));
  const priceBefore = await paneScaleAt(page, PRICE_PANE);
  await button.click();
  await expect.poll(async () => read(await paneScaleAt(page, INDICATOR_PANE))).toBe(!indicatorBefore);
  expect(await paneScaleAt(page, PRICE_PANE)).toEqual(priceBefore);
  await expect(button).toHaveAttribute('aria-pressed', String(!indicatorBefore));
}

/** The value on bar `barIndex`, rising from `first` at the oldest bar to `last` at the newest. */
function valueBetween(barIndex: number, barCount: number, first: number, last: number): number {
  const span = last - first;
  return first + (span * barIndex) / Math.max(barCount - 1, 1);
}

/** The frame `plot` alone draws over `times`, its values rising from `first` to `last`. */
function risingFrame(plot: IndicatorPlot, times: readonly number[], first: number, last: number): IndicatorFrame {
  return frameOf([plot], times, (_plotIndex, barIndex) => valueBetween(barIndex, times.length, first, last));
}

/** The frame `plot` alone draws over `times`, with the whole history of the values above. */
function stepFrame(plot: IndicatorPlot, times: readonly number[]): IndicatorFrame {
  return risingFrame(plot, times, STEP_VALUE_START, STEP_VALUE_END);
}

/** Fits pane 1 to its data when it opens unfitted: pressing `A` is the only way back to autoscale. */
async function fitIndicatorPane(page: Page): Promise<void> {
  if ((await paneScaleAt(page, INDICATOR_PANE)).autoScale) {
    return;
  }
  await hoverAxis(page, await chartLayout(page), 'indicator');
  await expect(paneRow(page, INDICATOR_ROW)).toHaveClass(REVEALED);
  await paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_AUTO }).click();
  await expect.poll(async () => (await paneScaleAt(page, INDICATOR_PANE)).autoScale).toBe(true);
}

/** Opens the app with `plot` alone in a pane of its own, its values rising from `first` to `last`. */
async function openWithValues(
  page: Page,
  plot: IndicatorPlot,
  first: number,
  last: number,
): Promise<readonly number[]> {
  const times = await openChartTimes(page);
  await showFrame(page, DEMO_ID, risingFrame(plot, times, first, last), 'own');
  await expect.poll(async () => page.evaluate(() => window.__chartTest!.paneCount())).toBe(2);
  // The row of the new pane is created from the panes' layout, which lands a frame after the pane does.
  await expect.poll(async () => page.locator('.price-scale-controls').count()).toBe(2);
  await waitTwoAnimationFrames(page);
  return times;
}

/**
 * Opens the app with `plot` alone in a pane of its own, drawn over values that all sit above zero, and
 * answers the bar times that history holds.
 */
async function openWithStepPlot(page: Page, plot: IndicatorPlot): Promise<readonly number[]> {
  const times = await openWithValues(page, plot, STEP_VALUE_START, STEP_VALUE_END);
  await fitIndicatorPane(page);
  return times;
}

/** Waits until pane 1's lowest drawn price satisfies `accepts`, which a scale holding no range never does. */
async function expectLowestVisiblePrice(page: Page, accepts: (lowestPrice: number) => boolean): Promise<void> {
  await expect
    .poll(async () => {
      const { lowestVisiblePrice } = await paneScaleAt(page, INDICATOR_PANE);
      return lowestVisiblePrice !== null && accepts(lowestVisiblePrice);
    })
    .toBe(true);
}

/** What the page measured between starting the probe and reading it back. */
interface LayoutProbeReadings {
  /** The elements inside the chart host, the host itself aside, whose rect was read. */
  readonly rectReads: string[];
  /** How many times a scale row's inline style was written. */
  readonly styleWrites: number;
}

/** A measurement running in the page, whose `stop` puts the page back as it found it. */
interface LayoutProbe {
  readings(): LayoutProbeReadings;
  stop(): void;
}

/**
 * Measures the page from now on: every rect read of an element inside the chart host, and every write to
 * a scale row's inline style. The host's own rect and the library's canvases are left out — the pointer
 * hit test and the library read those on every move, and the panes and the rows are what a move must leave
 * alone.
 */
async function startLayoutProbe(page: Page): Promise<JSHandle<LayoutProbe>> {
  return page.evaluateHandle((): LayoutProbe => {
    // The library reads its own canvases on every move, which the panes and the rows have no part in.
    const LIBRARY_CANVAS_TAG = 'CANVAS';
    const host = document.querySelector('.chart-host');
    const rectReads: string[] = [];
    let styleWrites = 0;
    const measure = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function probedRect(this: Element): DOMRect {
      if (host !== null && this !== host && host.contains(this) && this.tagName !== LIBRARY_CANVAS_TAG) {
        rectReads.push(this.getAttribute('class') ?? this.tagName);
      }
      return measure.call(this);
    };
    const observer = new MutationObserver(() => {
      styleWrites += 1;
    });
    document.querySelectorAll('.price-scale-controls').forEach((row) => {
      observer.observe(row, { attributes: true, attributeFilter: ['style'] });
    });
    return {
      readings: () => ({ rectReads: [...rectReads], styleWrites }),
      stop: () => {
        Element.prototype.getBoundingClientRect = measure;
        observer.disconnect();
      },
    };
  });
}

/** Reads the probe back and stops it, so no wrapped rect read outlives the test. */
async function stopLayoutProbe(probe: JSHandle<LayoutProbe>): Promise<LayoutProbeReadings> {
  const readings = await probe.evaluate((running) => {
    const measured = running.readings();
    running.stop();
    return measured;
  });
  await probe.dispose();
  return readings;
}

test('a stepped plot anchored at zero keeps price zero on its pane scale', async ({ page }) => {
  await openWithStepPlot(page, ANCHORED_STEP_PLOT);
  await expectLowestVisiblePrice(page, (lowestPrice) => lowestPrice <= 0);
});

test('the same stepped plot without the anchor fits only the values it draws', async ({ page }) => {
  await openWithStepPlot(page, STEP_PLOT);
  await expectLowestVisiblePrice(page, (lowestPrice) => lowestPrice > 0);
});

test('an indicator pane adds its own row under the price pane row', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  const layout = await chartLayout(page);
  // The price pane's row stays first in the DOM.
  expect(layout.rows.map((row) => row.label)).toEqual([PRICE_ROW, INDICATOR_ROW]);
  const priceRow = rowAt(layout, PRICE_ROW);
  const indicatorRow = rowAt(layout, INDICATOR_ROW);
  // At the foot of the price pane, and at or above the top of the RSI pane's own row.
  expectRowAtPaneFoot(priceRow, layout.priceBottom);
  expect(priceRow.bottom).toBeLessThanOrEqual(indicatorRow.top);
  // Inside the RSI pane, at the foot of its own axis.
  expect(indicatorRow.top).toBeGreaterThanOrEqual(layout.priceBottom - PLACEMENT_SLACK);
  expectRowAtPaneFoot(indicatorRow, layout.indicatorBottom);
  // Both rows sit in the axis column, never over the plot area.
  for (const row of layout.rows) {
    expect(row.right).toBeLessThanOrEqual(layout.host.right + PLACEMENT_SLACK);
    expect(row.left).toBeGreaterThanOrEqual(layout.host.right - layout.axisWidth - PLACEMENT_SLACK);
  }
});

test('hovering one pane axis reveals only that pane row', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  const layout = await chartLayout(page);
  await hoverAxis(page, layout, 'indicator');
  await expect(paneRow(page, INDICATOR_ROW)).toHaveClass(REVEALED);
  await expect(paneRow(page, PRICE_ROW)).not.toHaveClass(REVEALED);
  await hoverAxis(page, layout, 'price');
  await expect(paneRow(page, PRICE_ROW)).toHaveClass(REVEALED);
  await expect(paneRow(page, INDICATOR_ROW)).not.toHaveClass(REVEALED);
});

test('the RSI row A and L change only the RSI pane', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  await hoverAxis(page, await chartLayout(page), 'indicator');
  const autoButton = paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_AUTO });
  const logButton = paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_LOG });
  await expectOnlyIndicatorPaneFlips(page, autoButton, (scale) => scale.autoScale);
  await expectOnlyIndicatorPaneFlips(page, logButton, (scale) => scale.logarithmic);
});

test('an A choice on an indicator pane survives a reload of its history', async ({ page }) => {
  const times = await openWithStepPlot(page, STEP_PLOT);
  await hoverAxis(page, await chartLayout(page), 'indicator');
  const autoButton = paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_AUTO });
  await expectOnlyIndicatorPaneFlips(page, autoButton, (scale) => scale.autoScale);
  const chosen = (await paneScaleAt(page, INDICATOR_PANE)).autoScale;
  // A reload draws the whole frame again, on the pane the indicator already holds.
  await showFrame(page, DEMO_ID, stepFrame(STEP_PLOT, times), 'own');
  await expect.poll(async () => (await paneScaleAt(page, INDICATOR_PANE)).autoScale).toBe(chosen);
});

test('a pane holding a value below zero disables its logarithmic button', async ({ page }) => {
  await openWithValues(page, STEP_PLOT, NEGATIVE_VALUE_START, STEP_VALUE_END);
  await hoverAxis(page, await chartLayout(page), 'indicator');
  const logButton = paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_LOG });
  await expect(logButton).toBeDisabled();
  await expect(logButton).toHaveAttribute('title', LOG_NEEDS_POSITIVE_VALUES);
});

test('a pane holding only values above zero keeps its logarithmic button and takes the press', async ({ page }) => {
  await openWithStepPlot(page, STEP_PLOT);
  await hoverAxis(page, await chartLayout(page), 'indicator');
  const logButton = paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_LOG });
  await expect(logButton).toBeEnabled();
  await logButton.click();
  await expect.poll(async () => (await paneScaleAt(page, INDICATOR_PANE)).logarithmic).toBe(true);
  await expect(logButton).toHaveAttribute('aria-pressed', 'true');
});

test('removing the indicator leaves the price pane row alone', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  await page.evaluate((instance) => window.__chartTest!.detachIndicator(instance), paneInstanceId('rsi'));
  await expect.poll(async () => page.evaluate(() => window.__chartTest!.paneCount())).toBe(1);
  await expect(page.locator('.price-scale-controls')).toHaveCount(1);
});

test('a pointer move over the plot area measures no pane and writes no row', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  const layout = await chartLayout(page);
  const plotX = (layout.host.left + layout.host.right) / 2;
  const plotY = layout.priceBottom + PLOT_PROBE_INSET;
  // A warm-up move first, so the probe measures a move the chart has already answered once.
  await page.mouse.move(plotX, plotY);
  const probe = await startLayoutProbe(page);
  await page.mouse.move(plotX + PLOT_PROBE_STEP, plotY + PLOT_PROBE_STEP);
  const readings = await stopLayoutProbe(probe);
  expect(readings.rectReads).toEqual([]);
  expect(readings.styleWrites).toBe(0);
});

test('a row follows its pane when the viewport shrinks', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  const openedRow = rowAt(await chartLayout(page), INDICATOR_ROW);
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await page.setViewportSize({ width: viewport.width, height: viewport.height - VIEWPORT_HEIGHT_STEP });
  // The layout watcher re-places every row from its pane's new geometry, with no drag of the user's.
  await expect.poll(async () => rowAt(await chartLayout(page), INDICATOR_ROW).bottom).toBeLessThan(openedRow.bottom);
  const resized = await chartLayout(page);
  expectRowAtPaneFoot(rowAt(resized, INDICATOR_ROW), resized.indicatorBottom);
});
