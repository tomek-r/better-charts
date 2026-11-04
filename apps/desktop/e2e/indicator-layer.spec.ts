import { expect, test, type Page } from '@playwright/test';
import type { IndicatorFrame, IndicatorPlot } from '../src/features/chart/engine/indicators/indicatorFrame';
import { openChart } from './helpers/openChart';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * The display layer for indicator frames: one line per plot on the price pane, a missing value breaking
 * the line, and a live frame replacing the forming bar instead of redrawing the history.
 */

/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** The id the demo indicator is drawn under. */
const DEMO_ID = 'demo';
/** The two plots of the demo indicator: a plain line and a stepped one. */
const FAST_PLOT: IndicatorPlot = { title: 'fast', style: 'line', color: '#2962ff', lineWidth: 2 };
const SLOW_PLOT: IndicatorPlot = { title: 'slow', style: 'stepline', color: '#ff6d00', lineWidth: 1 };
/** The colour one point paints, which no plot is drawn with. */
const POINT_COLOR = '#ff0000';
/** The bar a test colours; its neighbours must keep their own colour. */
const COLOURED_BAR = 3;

/** A frame of `plots` over `times`, where `valueAt` says what plot `plotIndex` plots on bar `barIndex`. */
function frameOf(
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

/** The same frame with one bar's per-plot colours set, as a producer reporting coloured points sends it. */
function colouredFrame(frame: IndicatorFrame, barIndex: number, colors: readonly (string | null)[]): IndicatorFrame {
  return { ...frame, bars: frame.bars.map((bar, index) => (index === barIndex ? { ...bar, colors } : bar)) };
}

/** The drawn points of a plot that plots `valueAt(barIndex)` on every bar, with no per-point colour. */
function pointsOf(times: readonly number[], valueAt: (barIndex: number) => number | null) {
  return times.map((time, barIndex) => ({ time, value: valueAt(barIndex), color: null }));
}

/**
 * The opening every test shares: the stub page, the chart it opens, and the bar times that chart holds,
 * in the UTC seconds every point is keyed by.
 */
async function openChartTimes(page: Page): Promise<number[]> {
  await gotoWithStub(page);
  await openChart(page);
  const bars = await page.evaluate(() => window.__chartTest!.data());
  return bars.map((bar) => bar.time);
}

async function showFrame(page: Page, id: string, frame: IndicatorFrame): Promise<void> {
  await page.evaluate(({ id, frame }) => window.__chartTest!.showIndicatorFrame(id, frame), { id, frame });
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

/** Every indicator the display layer draws, in the order it was shown. */
async function drawnIndicators(page: Page) {
  return page.evaluate(() => window.__chartTest!.indicators());
}

test('a frame draws one line per plot with its values', async ({ page }) => {
  const times = await openChartTimes(page);

  const valuesAt = (plotIndex: number, barIndex: number) => (plotIndex === 0 ? barIndex + 1 : (barIndex + 1) * 2);
  await showFrame(page, DEMO_ID, frameOf([FAST_PLOT, SLOW_PLOT], times, valuesAt));

  const indicators = await drawnIndicators(page);
  expect(indicators.map((indicator) => indicator.id)).toEqual([DEMO_ID]);
  expect(indicators[0].plots).toEqual([
    { title: 'fast', color: '#2962ff', lineWidth: 2, lineType: 'simple', points: pointsOf(times, (bar) => bar + 1) },
    {
      title: 'slow',
      color: '#ff6d00',
      lineWidth: 1,
      lineType: 'step',
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
