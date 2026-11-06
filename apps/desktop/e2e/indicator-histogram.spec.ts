import { expect, test, type Page } from '@playwright/test';
import type {
  IndicatorFrame,
  IndicatorLevel,
  IndicatorPlot,
} from '../src/features/chart/engine/indicators/indicatorFrame';
import {
  DEMO_ID,
  FAST_PLOT,
  colouredFrame,
  drawnIndicators,
  frameOf,
  openChartTimes,
  showFrame,
} from './helpers/indicatorFrames';

/**
 * The display layer for a histogram plot: its columns drawn as a histogram series, each column painted with
 * the colour its bar carries, a switched-off histogram hidden while the frame's level stays on the line
 * plot, and the layer's own hide and show keeping that histogram switched off.
 */

/** The histogram plot under test: columns from zero, the plot's colour unless a bar carries its own. */
const HISTOGRAM_PLOT: IndicatorPlot = { title: 'hist', style: 'histogram', color: '#26a69a', lineWidth: 1 };
/** The colour one column paints, which no plot is drawn with. */
const COLUMN_COLOR = '#ff5252';
/** The bar a test colours; its neighbours must keep the plot's colour. */
const COLOURED_BAR = 3;
/** The level a switched-off histogram's frame still draws, on the line plot that draws with it. */
const ZERO_LEVEL: IndicatorLevel = { title: 'Zero', price: 0, color: '#787b86', lineWidth: 1 };

/** A switched-off histogram beside a plain line over `times`, with the frame's zero level drawn. */
function switchedOffHistogramAndLine(times: readonly number[]): IndicatorFrame {
  const plots: IndicatorPlot[] = [{ ...HISTOGRAM_PLOT, visible: false }, FAST_PLOT];
  return { ...frameOf(plots, times, (_plot, bar) => bar - 4), levels: [ZERO_LEVEL] };
}

/** Hides or shows the demo indicator through the layer's own switch, as the legend or a menu does. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate(({ id, hidden }) => window.__chartTest!.setIndicatorFrameHidden(id, hidden), {
    id: DEMO_ID,
    hidden,
  });
}

test("a histogram plot draws columns in each bar's colour", async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(
    page,
    DEMO_ID,
    colouredFrame(
      frameOf([HISTOGRAM_PLOT], times, (_plot, bar) => bar - 4),
      COLOURED_BAR,
      [COLUMN_COLOR],
    ),
  );

  const [demo] = await drawnIndicators(page);
  const [histogram] = demo.plots;
  expect(histogram.lineType).toBe('histogram');
  expect(histogram.points.map((point) => point.color)).toEqual(
    times.map((_time, bar) => (bar === COLOURED_BAR ? COLUMN_COLOR : null)),
  );
});

test('a switched-off histogram hides its columns but keeps the levels on the line plot', async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(page, DEMO_ID, switchedOffHistogramAndLine(times));

  const [demo] = await drawnIndicators(page);
  expect(demo.plots.map((plot) => plot.visible)).toEqual([false, true]);
  expect(demo.levels).toEqual([{ title: 'Zero', price: 0, color: '#787b86', visible: true }]);
});

test('hiding and showing an indicator restores a switched-off histogram as switched off', async ({ page }) => {
  const times = await openChartTimes(page);
  await showFrame(page, DEMO_ID, switchedOffHistogramAndLine(times));

  await setHidden(page, true);
  const [hidden] = await drawnIndicators(page);
  // The whole indicator is hidden; a line's own switch, which the plot reports, stays on.
  expect(hidden.hidden).toBe(true);
  expect(hidden.plots.map((plot) => plot.visible)).toEqual([false, true]);

  await setHidden(page, false);
  const [shown] = await drawnIndicators(page);
  expect(shown.hidden).toBe(false);
  expect(shown.plots.map((plot) => plot.visible)).toEqual([false, true]);
});
