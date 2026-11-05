import { expect, test, type Page } from '@playwright/test';
import type {
  IndicatorFill,
  IndicatorFrame,
  IndicatorLevel,
  IndicatorPlot,
} from '../src/features/chart/engine/indicators/indicatorFrame';
import {
  DEMO_ID,
  FAST_PLOT,
  SLOW_PLOT,
  colouredFrame,
  drawnIndicators,
  frameOf,
  openChartTimes,
  showFrame,
} from './helpers/indicatorFrames';

/**
 * The display layer for indicator frames: one line per plot on the price pane, a missing value breaking
 * the line, a live frame replacing the forming bar instead of redrawing the history, and the frame's
 * levels, fills and per-plot styles reaching the chart unchanged.
 */

/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The colour one point paints, which no plot is drawn with. */
const POINT_COLOR = '#ff0000';
/** The bar a test colours; its neighbours must keep their own colour. */
const COLOURED_BAR = 3;
/** The two levels of a band: one drawn dashed, one switched off by its producer. */
const UPPER_LEVEL: IndicatorLevel = {
  title: 'Upper',
  price: 70,
  color: '#787b86',
  lineWidth: 1,
  lineStyle: 'dashed',
};
const LOWER_LEVEL: IndicatorLevel = { title: 'Lower', price: 30, color: '#787b86', lineWidth: 1, visible: false };
/** The faint colour of the band between the two plots. */
const BAND_COLOR = '#2196f30d';
/** The band painted between the demo's two plots. */
const PLOT_BAND: IndicatorFill = {
  from: { kind: 'plot', index: 0 },
  to: { kind: 'plot', index: 1 },
  color: BAND_COLOR,
};

/** `frame` with the levels and fills a producer describes for the whole frame rather than for one bar. */
function withLevelsAndFills(
  frame: IndicatorFrame,
  levels: readonly IndicatorLevel[],
  fills: readonly IndicatorFill[],
): IndicatorFrame {
  return { ...frame, levels, fills };
}

/** The drawn points of a plot that plots `valueAt(barIndex)` on every bar, with no per-point colour. */
function pointsOf(times: readonly number[], valueAt: (barIndex: number) => number | null) {
  return times.map((time, barIndex) => ({ time, value: valueAt(barIndex), color: null }));
}

/** Shows one `plot` under `id` over `times`, where `valueAt` says what it plots on bar `barIndex`. */
async function showPlot(
  page: Page,
  id: string,
  plot: IndicatorPlot,
  times: readonly number[],
  valueAt: (barIndex: number) => number | null,
): Promise<void> {
  await showFrame(
    page,
    id,
    frameOf([plot], times, (_plot, barIndex) => valueAt(barIndex)),
  );
}

async function updateFrame(page: Page, id: string, frame: IndicatorFrame): Promise<void> {
  await page.evaluate(({ id, frame }) => window.__chartTest!.updateIndicatorFrame(id, frame), { id, frame });
}

test('a frame draws one line per plot with its values', async ({ page }) => {
  const times = await openChartTimes(page);

  const valuesAt = (plotIndex: number, barIndex: number) => (plotIndex === 0 ? barIndex + 1 : (barIndex + 1) * 2);
  await showFrame(page, DEMO_ID, frameOf([FAST_PLOT, SLOW_PLOT], times, valuesAt));

  const indicators = await drawnIndicators(page);
  expect(indicators.map((indicator) => indicator.id)).toEqual([DEMO_ID]);
  expect(indicators[0].plots).toEqual([
    {
      title: 'fast',
      color: '#2962ff',
      lineWidth: 2,
      lineType: 'simple',
      lineStyle: 'solid',
      visible: true,
      priceLabelVisible: false,
      points: pointsOf(times, (bar) => bar + 1),
    },
    {
      title: 'slow',
      color: '#ff6d00',
      lineWidth: 1,
      lineType: 'step',
      lineStyle: 'solid',
      visible: true,
      priceLabelVisible: false,
      points: pointsOf(times, (bar) => (bar + 1) * 2),
    },
  ]);
});

test('a missing value breaks the line', async ({ page }) => {
  const times = await openChartTimes(page);

  await showPlot(page, DEMO_ID, FAST_PLOT, times, (bar) => (bar === 0 || bar === 5 ? null : bar + 1));

  const [demo] = await drawnIndicators(page);
  const [line] = demo.plots;
  // The library drops the whitespace that breaks the line from `series.data()`, so a missing value is a missing point.
  expect(line.points.map((point) => point.time)).toEqual(times.filter((_time, bar) => bar !== 0 && bar !== 5));
  expect(line.points.map((point) => point.value)).toEqual([2, 3, 4, 5, 7, 8, 9, 10]);
});

test('a bar colour paints that point only', async ({ page }) => {
  const times = await openChartTimes(page);
  const frame = frameOf([FAST_PLOT], times, (_plot, bar) => bar + 1);

  await showFrame(page, DEMO_ID, colouredFrame(frame, COLOURED_BAR, [POINT_COLOR]));

  const [demo] = await drawnIndicators(page);
  const [line] = demo.plots;
  expect(line.points.map((point) => point.color)).toEqual([
    null,
    null,
    null,
    '#ff0000',
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});

test('a live frame replaces the forming bar and appends a newer one', async ({ page }) => {
  const times = await openChartTimes(page);
  await showPlot(page, DEMO_ID, FAST_PLOT, times, (bar) => bar + 1);

  const lastTime = times[times.length - 1];
  const nextTime = lastTime + (lastTime - times[times.length - 2]);
  const liveValues = (bar: number) => (bar === 0 ? 99 : 100);
  await updateFrame(
    page,
    DEMO_ID,
    frameOf([FAST_PLOT], [lastTime, nextTime], (_plot, bar) => liveValues(bar)),
  );

  const [demo] = await drawnIndicators(page);
  const [line] = demo.plots;
  expect(line.points).toHaveLength(11);
  expect(line.points.slice(-2)).toEqual([
    { time: lastTime, value: 99, color: null },
    { time: nextTime, value: 100, color: null },
  ]);
});

test('a live bar older than the last one is ignored', async ({ page }) => {
  const times = await openChartTimes(page);
  await showPlot(page, DEMO_ID, FAST_PLOT, times, (bar) => bar + 1);

  await updateFrame(
    page,
    DEMO_ID,
    frameOf([FAST_PLOT], [times[2]], () => 99),
  );

  const [demo] = await drawnIndicators(page);
  const [line] = demo.plots;
  expect(line.points).toHaveLength(times.length);
  expect(line.points.map((point) => point.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('showing again replaces the plots', async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(
    page,
    DEMO_ID,
    frameOf([FAST_PLOT, SLOW_PLOT], times, (_plot, bar) => bar + 1),
  );
  await showPlot(page, DEMO_ID, FAST_PLOT, times, (bar) => bar + 1);

  const indicators = await drawnIndicators(page);
  expect(indicators.map((indicator) => indicator.id)).toEqual([DEMO_ID]);
  expect(indicators[0].plots.map((plot) => plot.title)).toEqual(['fast']);
});

test('a width beyond the line widths is clamped', async ({ page }) => {
  const times = await openChartTimes(page);
  const wide = { ...FAST_PLOT, title: 'too wide', lineWidth: 7 };
  const narrow = { ...FAST_PLOT, title: 'too narrow', lineWidth: 0 };

  await showFrame(
    page,
    DEMO_ID,
    frameOf([wide, narrow], times, () => 1),
  );

  const [demo] = await drawnIndicators(page);
  expect(demo.plots.map((plot) => plot.lineWidth)).toEqual([4, 1]);
});

test('removing an indicator removes only its lines', async ({ page }) => {
  const times = await openChartTimes(page);
  await showPlot(page, 'a', FAST_PLOT, times, (bar) => bar + 1);
  await showPlot(page, 'b', SLOW_PLOT, times, (bar) => bar + 1);

  await page.evaluate(() => window.__chartTest!.removeIndicator('a'));

  const indicators = await drawnIndicators(page);
  expect(indicators.map((indicator) => indicator.id)).toEqual(['b']);
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(STUB_BAR_COUNT);
});

test('a dashed plot and a switched-off plot keep their style', async ({ page }) => {
  const times = await openChartTimes(page);
  const dashed: IndicatorPlot = { ...FAST_PLOT, lineStyle: 'dashed' };
  const switchedOff: IndicatorPlot = { ...SLOW_PLOT, visible: false };

  await showFrame(
    page,
    DEMO_ID,
    frameOf([dashed, switchedOff], times, () => 1),
  );

  const [demo] = await drawnIndicators(page);
  expect(demo.plots.map((plot) => plot.lineStyle)).toEqual(['dashed', 'solid']);
  expect(demo.plots.map((plot) => plot.visible)).toEqual([true, false]);
});

test('levels are drawn as price lines and keep their own visibility', async ({ page }) => {
  const times = await openChartTimes(page);
  const levels = [UPPER_LEVEL, LOWER_LEVEL];

  await showFrame(
    page,
    DEMO_ID,
    withLevelsAndFills(
      frameOf([FAST_PLOT], times, () => 1),
      levels,
      [],
    ),
  );

  const [demo] = await drawnIndicators(page);
  expect(demo.levels).toEqual([
    { title: 'Upper', price: 70, color: '#787b86', visible: true },
    { title: 'Lower', price: 30, color: '#787b86', visible: false },
  ]);
});

test('a fill between two plots is recorded with its edges', async ({ page }) => {
  const times = await openChartTimes(page);
  const twoPlots = frameOf([FAST_PLOT, SLOW_PLOT], times, (plotIndex, barIndex) => barIndex + 1 + plotIndex * 2);

  await showFrame(page, DEMO_ID, withLevelsAndFills(twoPlots, [], [PLOT_BAND]));

  const [demo] = await drawnIndicators(page);
  expect(demo.fills).toEqual([PLOT_BAND]);
});

test('removing an indicator takes its levels and fills with it', async ({ page }) => {
  const times = await openChartTimes(page);
  const twoPlots = frameOf([FAST_PLOT, SLOW_PLOT], times, (plotIndex, barIndex) => barIndex + 1 + plotIndex * 2);
  await showFrame(page, DEMO_ID, withLevelsAndFills(twoPlots, [UPPER_LEVEL], [PLOT_BAND]));

  await page.evaluate((id) => window.__chartTest!.removeIndicator(id), DEMO_ID);

  expect(await drawnIndicators(page)).toEqual([]);
  expect(await page.evaluate(() => window.__chartTest!.data().length)).toBe(STUB_BAR_COUNT);
});
