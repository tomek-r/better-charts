import { expect, test, type Page } from '@playwright/test';
import type { IndicatorPlot, IndicatorPlotStyle } from '../src/features/chart/engine/indicators/indicatorFrame';
import { frameLookKey } from '../src/features/chart/engine/indicators/indicatorFrameLook';
import {
  crossSegments,
  diamondSegments,
  markerCircle,
  markerHalfSize,
  markerStrokeWidth,
  stemSegment,
} from '../src/features/chart/engine/indicators/indicatorPlotMarkers';
import type { IndicatorPlotState } from '../src/features/chart/engine/indicators/indicatorPlotSeries';
import { PLOT_TYPE_STYLE } from '../src/features/indicators/volume/volumeIndicator';
import {
  DEMO_ID,
  colouredFrame,
  drawnIndicators,
  frameOf,
  openChartTimes,
  removeIndicator,
  showFrame,
} from './helpers/indicatorFrames';
import { failOnPageNoise } from './helpers/pageNoise';
import { openWithSavedIndicators } from './helpers/savedIndicators';

/**
 * The plot types beyond a plain line and columns: an area, stems, crosses, circles and a stepped line
 * with diamonds report their own line type, gaps decide whether a missing value breaks the plot, the
 * price line switch reaches the series, and every type removes cleanly.
 */

/** The five types this spec draws, with the line type the display layer reports for each. */
const PLOT_TYPE_CASES = [
  { style: 'area', lineType: 'area' },
  { style: 'stems', lineType: 'stems' },
  { style: 'crosses', lineType: 'crosses' },
  { style: 'circles', lineType: 'circles' },
  { style: 'steplineDiamonds', lineType: 'stepDiamonds' },
] as const;

const PLOT_TITLE = 'marks';
const PLOT_COLOR = '#26a69a';

/** The level both shows of the repeated-show test declare, which the second show must leave as it is. */
const LEVEL = { title: 'zero', price: 0, color: '#787b86', lineWidth: 1 };

/** How far the second show of the repeated-show test moves every value on. */
const NEW_VALUE_OFFSET = 10;

/** The value every bar plots unless a test says otherwise. */
function barValue(_plotIndex: number, barIndex: number): number {
  return barIndex + 1;
}

/** One plot of `style`, with the switches a test asks for. */
function plotOf(style: IndicatorPlotStyle, options: Pick<IndicatorPlot, 'gaps' | 'priceLine'> = {}): IndicatorPlot {
  return { title: PLOT_TITLE, style, color: PLOT_COLOR, lineWidth: 1, ...options };
}

/** Shows `plots` over the opened chart's bars and reports what the layer drew for them. */
async function shownPlotsOf(
  page: Page,
  plots: readonly IndicatorPlot[],
  valueAt: (plotIndex: number, barIndex: number) => number | null = barValue,
): Promise<readonly IndicatorPlotState[]> {
  const times = await openChartTimes(page);
  await showFrame(page, DEMO_ID, frameOf(plots, times, valueAt));
  const [demo] = await drawnIndicators(page);
  return demo.plots;
}

test.describe('plot types', () => {
  failOnPageNoise();

  for (const { style, lineType } of PLOT_TYPE_CASES) {
    test(`a ${style} plot reports the ${lineType} line type`, async ({ page }) => {
      const [plot] = await shownPlotsOf(page, [plotOf(style)]);

      expect(plot).toMatchObject({ title: PLOT_TITLE, lineType });
    });
  }

  test('a plot joining across a missing value holds one point fewer and no break', async ({ page }) => {
    const times = await openChartTimes(page);
    const gapBar = 2;

    await showFrame(
      page,
      DEMO_ID,
      frameOf([plotOf('area', { gaps: 'connect' })], times, (_plot, bar) => (bar === gapBar ? null : bar + 1)),
    );

    const [demo] = await drawnIndicators(page);
    expect(demo.plots[0].points).toHaveLength(times.length - 1);
    expect(demo.plots[0].points.map((point) => point.time)).not.toContain(times[gapBar]);
  });

  test('the price line switch reaches the plot it is set on', async ({ page }) => {
    const plots = await shownPlotsOf(page, [plotOf('crosses', { priceLine: true }), plotOf('circles')]);

    expect(plots.map((plot) => plot.priceLineVisible)).toEqual([true, false]);
  });

  test('a switched-off crosses plot reports itself as not visible', async ({ page }) => {
    const [plot] = await shownPlotsOf(page, [{ ...plotOf('crosses'), visible: false }]);

    expect(plot.visible).toBe(false);
  });

  for (const { style, lineType } of PLOT_TYPE_CASES) {
    test(`removing a ${style} indicator leaves nothing drawn`, async ({ page }) => {
      const [plot] = await shownPlotsOf(page, [plotOf(style)]);
      expect(plot.lineType).toBe(lineType);

      await removeIndicator(page, DEMO_ID);

      expect(await drawnIndicators(page)).toEqual([]);
    });
  }

  test('a repeated show with the same look keeps the level lines and rewrites the bars', async ({ page }) => {
    const times = await openChartTimes(page);
    const plots = [plotOf('area')];
    await showFrame(page, DEMO_ID, { ...frameOf(plots, times, barValue), levels: [LEVEL] });
    const [firstShow] = await drawnIndicators(page);

    await showFrame(page, DEMO_ID, {
      ...frameOf(plots, times, (_plotIndex, barIndex) => barValue(0, barIndex) + NEW_VALUE_OFFSET),
      levels: [LEVEL],
    });
    const [secondShow] = await drawnIndicators(page);

    expect(secondShow.levels).toEqual(firstShow.levels);
    expect(secondShow.paneIndex).toBe(firstShow.paneIndex);
    expect(secondShow.plots[0].lineType).toBe(firstShow.plots[0].lineType);
    expect(secondShow.plots[0].points.map((point) => point.value)).toEqual(
      firstShow.plots[0].points.map((point) => point.value + NEW_VALUE_OFFSET),
    );
  });

  test('a show whose look changed draws its plots again in the new style', async ({ page }) => {
    const times = await openChartTimes(page);
    await showFrame(page, DEMO_ID, frameOf([plotOf('area')], times, barValue));
    await showFrame(page, DEMO_ID, frameOf([plotOf('histogram')], times, barValue));

    const [demo] = await drawnIndicators(page);
    expect(demo.plots[0]).toMatchObject({ title: PLOT_TITLE, lineType: 'histogram' });
    expect(demo.plots[0].points).toHaveLength(times.length);
  });

  test('an area plot reports the colour its bar carries', async ({ page }) => {
    const times = await openChartTimes(page);
    const colouredBar = 1;
    const barColor = '#ef5350';
    await showFrame(page, DEMO_ID, colouredFrame(frameOf([plotOf('area')], times, barValue), colouredBar, [barColor]));

    const [demo] = await drawnIndicators(page);
    const [plot] = demo.plots;
    expect(plot.points[colouredBar]).toEqual({
      time: times[colouredBar],
      value: barValue(0, colouredBar),
      color: barColor,
    });
    expect(plot.points[colouredBar - 1].color).toBeNull();
  });

  test('a saved Volume set to the Cross plot type draws crosses under its own title', async ({ page }) => {
    await openWithSavedIndicators(page, [
      { instanceId: 'volume-1', definitionId: 'volume', settings: { [PLOT_TYPE_STYLE]: 'cross' } },
    ]);

    await expect.poll(async () => (await drawnIndicators(page)).length).toBe(1);

    const [volume] = await drawnIndicators(page);
    expect(volume.plots[0]).toMatchObject({ title: 'Volume', lineType: 'crosses' });
  });
});

test.describe('marker geometry', () => {
  test('sizes a marker to 7 CSS pixels across and its outline to 1', () => {
    expect(markerHalfSize(1)).toBe(3.5);
    expect(markerHalfSize(2)).toBe(7);
    expect(markerStrokeWidth(1)).toBe(1);
    expect(markerStrokeWidth(2)).toBe(2);
  });

  test('draws a stem from the value down to price zero', () => {
    expect(stemSegment(10, 30, 70)).toEqual({ from: { x: 10, y: 30 }, to: { x: 10, y: 70 } });
  });

  test('draws a cross as one arm across the point and one arm down it', () => {
    expect(crossSegments({ x: 50, y: 40 }, 3.5)).toEqual([
      { from: { x: 46.5, y: 40 }, to: { x: 53.5, y: 40 } },
      { from: { x: 50, y: 36.5 }, to: { x: 50, y: 43.5 } },
    ]);
  });

  test('draws a diamond as a square turned on its corner', () => {
    expect(diamondSegments({ x: 0, y: 0 }, 5)).toEqual([
      { from: { x: 0, y: -5 }, to: { x: 5, y: 0 } },
      { from: { x: 5, y: 0 }, to: { x: 0, y: 5 } },
      { from: { x: 0, y: 5 }, to: { x: -5, y: 0 } },
      { from: { x: -5, y: 0 }, to: { x: 0, y: -5 } },
    ]);
  });

  test('draws a circle whose diameter is the marker size', () => {
    expect(markerCircle({ x: 4, y: 6 }, 3.5)).toEqual({ centre: { x: 4, y: 6 }, radius: 3.5 });
  });
});

test.describe('frame look key', () => {
  const times = [1_700_000_000, 1_700_000_060];

  test('the same style over different bars keys the same', () => {
    const flatBars = frameOf([plotOf('line')], times, () => 1);
    const risingBars = frameOf([plotOf('line')], times, (_plotIndex, barIndex) => barIndex + 1);

    expect(frameLookKey(risingBars, 'overlay', false)).toBe(frameLookKey(flatBars, 'overlay', false));
  });

  test('another plot colour keys differently', () => {
    const plot = plotOf('line');
    const flatBars = frameOf([plot], times, () => 1);
    const recolouredBars = frameOf([{ ...plot, color: '#ff6d00' }], times, () => 1);

    expect(frameLookKey(recolouredBars, 'overlay', false)).not.toBe(frameLookKey(flatBars, 'overlay', false));
  });
});
