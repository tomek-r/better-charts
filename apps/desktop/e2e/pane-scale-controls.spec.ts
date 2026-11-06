import { expect, test, type Locator, type Page } from '@playwright/test';
import type { IndicatorPlot } from '../src/features/chart/engine/indicators/indicatorFrame';
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

/** The stepped plot's value on bar `barIndex`: 500 at the oldest bar, rising to 600 at the newest. */
function stepValueAt(barIndex: number, barCount: number): number {
  const span = STEP_VALUE_END - STEP_VALUE_START;
  return STEP_VALUE_START + (span * barIndex) / Math.max(barCount - 1, 1);
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

/** Opens the app with `plot` alone in a pane of its own, drawn over values that all sit above zero. */
async function openWithStepPlot(page: Page, plot: IndicatorPlot): Promise<void> {
  const times = await openChartTimes(page);
  const frame = frameOf([plot], times, (_plotIndex, barIndex) => stepValueAt(barIndex, times.length));
  await showFrame(page, DEMO_ID, frame, 'own');
  await expect.poll(async () => page.evaluate(() => window.__chartTest!.paneCount())).toBe(2);
  // The row of the new pane is created from the panes' layout, which lands a frame after the pane does.
  await expect.poll(async () => page.locator('.price-scale-controls').count()).toBe(2);
  await waitTwoAnimationFrames(page);
  await fitIndicatorPane(page);
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
  expect(priceRow.bottom).toBeGreaterThan(layout.priceBottom - ROW_OFFSET_LIMIT);
  expect(priceRow.bottom).toBeLessThanOrEqual(layout.priceBottom + PLACEMENT_SLACK);
  expect(priceRow.bottom).toBeLessThanOrEqual(indicatorRow.top);
  // Inside the RSI pane, at the foot of its own axis.
  expect(indicatorRow.top).toBeGreaterThanOrEqual(layout.priceBottom - PLACEMENT_SLACK);
  expect(indicatorRow.bottom).toBeGreaterThan(layout.indicatorBottom - ROW_OFFSET_LIMIT);
  expect(indicatorRow.bottom).toBeLessThanOrEqual(layout.indicatorBottom + PLACEMENT_SLACK);
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

test('the MACD pane takes a logarithmic scale without page errors', async ({ page }) => {
  await openWithIndicatorPane(page, 'macd');
  await hoverAxis(page, await chartLayout(page), 'indicator');
  // The MACD's values run below zero, which a logarithmic scale cannot draw: the press must not throw.
  await paneRow(page, INDICATOR_ROW).getByRole('button', { name: INDICATOR_LOG }).click();
  await expect.poll(async () => (await paneScaleAt(page, INDICATOR_PANE)).logarithmic).toBe(true);
});

test('removing the indicator leaves the price pane row alone', async ({ page }) => {
  await openWithIndicatorPane(page, 'rsi');
  await page.evaluate((instance) => window.__chartTest!.detachIndicator(instance), paneInstanceId('rsi'));
  await expect.poll(async () => page.evaluate(() => window.__chartTest!.paneCount())).toBe(1);
  await expect(page.locator('.price-scale-controls')).toHaveCount(1);
});
