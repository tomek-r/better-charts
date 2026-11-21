import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import type { IndicatorFrame } from '../src/features/chart/engine/indicators/indicatorFrame';
import type { SettingInputEnumOption, SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import {
  CALCULATION_GROUP,
  CALCULATION_TIMEFRAME_INPUT,
  CALCULATION_TIMEFRAME_TOOLTIP,
  WAIT_FOR_CLOSES_INPUT,
  calculationTimeframeChoices,
} from '../src/features/indicators/calculation/calculationInputs';
import { bucketBars, higherTimeframeBarTime } from '../src/features/indicators/calculation/higherTimeframeBars';
import { projectHigherTimeframeFrame } from '../src/features/indicators/calculation/higherTimeframeFrame';
import { HigherTimeframeIndicator } from '../src/features/indicators/calculation/higherTimeframeIndicator';
import { withCalculation } from '../src/features/indicators/calculation/withCalculation';
import { CHART_INDICATOR_PLUGINS } from '../src/features/indicators/registry';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import { timeframeOptions } from '../src/shared/bridge/timeframes';
import { SMA_DIALOG_NAME, indicatorRows, openObjectTree } from './helpers/indicatorObjectTree';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';

failOnPageNoise();

/**
 * The Calculation section every built-in indicator carries: the timeframe it is calculated on, the wait for
 * that timeframe to close, the bars of a higher timeframe grouped from the chart's own bars, and the values
 * they give projected back onto those chart bars.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_M5 = 5 * SECONDS_PER_MINUTE;
/** Nine o'clock UTC, on a minute and a five-minute boundary, so every bucket of these cases starts there. */
const FIRST_BAR_SECONDS = Date.UTC(2023, 10, 14, 9, 0) / MILLISECONDS_PER_SECOND;

/** The stub chart's own timeframe, and the labels the choices these cases read are written with. */
const CHART_TIMEFRAME = 'M5';
const CHART_CHOICE_LABEL = '5m';
const SHORTER_CHOICE_LABEL = '1m';
const HIGHER_CHOICE = 'M15';
const HIGHER_CHOICE_LABEL = '15m';

/** The saved moving average the page cases start from, short enough to average two grouped bars. */
const SAVED_LENGTH = 2;
const SAVED_SMA = { instanceId: 'sma-1', definitionId: 'sma', settings: { length: SAVED_LENGTH } };
const SAVED_NAME = 'SMA 2 close';

/** The inputs the Calculation section adds to every built-in indicator: the timeframe and the wait switch. */
const CALCULATION_INPUT_COUNT = 2;

/** How far a tick moves the forming bar's close in the live-update case. */
const TICK_OFFSET = 10;

/** The SMA as the registry registers it: its own inputs plus the Calculation section. */
const REGISTERED_SMA = withCalculation(smaPlugin);

/** An M1 bar `offsetMinutes` after the first one, priced and weighted as the case gives it. */
function minuteBar(
  offsetMinutes: number,
  prices: { open: number; high: number; low: number; close: number },
  volume: number,
): RenderBar {
  return { time: FIRST_BAR_SECONDS + offsetMinutes * SECONDS_PER_MINUTE, ...prices, volume };
}

/** An M5 bar `offsetBars` after the first one, closing at `close` and flat all around it. */
function m5Bar(offsetBars: number, close: number): RenderBar {
  const time = FIRST_BAR_SECONDS + offsetBars * SECONDS_PER_M5;
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

/** The mean of every window of `length` values, with a null until the first window is full. */
function averageOf(values: readonly number[], length: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < length) {
      return null;
    }
    const window = values.slice(index + 1 - length, index + 1);
    return window.reduce((total, value) => total + value, 0) / length;
  });
}

/** The reason a choice is disabled, or undefined while a user can pick it. */
function reasonOf(choices: readonly SettingInputEnumOption[], value: string): string | undefined {
  return choices.find((choice) => choice.value === value)?.disabledReason;
}

/** The settings the registered SMA resolves for the calculation these cases ask of it. */
function calculationSettings(stored: SettingValues): SettingValues {
  return resolveSettingValues(indicatorSettingsSchema(REGISTERED_SMA), stored);
}

test.describe('the Calculation section', () => {
  test('every built-in indicator the registry lists carries it after its own inputs', () => {
    for (const plugin of CHART_INDICATOR_PLUGINS) {
      const sectionInputs = plugin.inputs?.slice(-CALCULATION_INPUT_COUNT);

      expect(sectionInputs?.map((input) => input.id)).toEqual([CALCULATION_TIMEFRAME_INPUT, WAIT_FOR_CLOSES_INPUT]);
      expect(sectionInputs?.map((input) => input.group)).toEqual([CALCULATION_GROUP, CALCULATION_GROUP]);
    }
  });

  test('Chart comes first, then the four tick options, then every MT5 timeframe by its label', () => {
    const choices = calculationTimeframeChoices(undefined);

    expect(choices.slice(0, 5).map((choice) => choice.title)).toEqual([
      'Chart',
      '1 tick',
      '10 ticks',
      '100 ticks',
      '1000 ticks',
    ]);
    expect(choices.slice(5).map((choice) => choice.value)).toEqual(timeframeOptions.map(({ wire }) => wire));
  });

  test("the tick options and the timeframes below the chart's own are disabled, each with its reason", () => {
    const choices = calculationTimeframeChoices(CHART_TIMEFRAME);

    expect(reasonOf(choices, 'tick1')).toBe('Needs tick data — coming next');
    expect(reasonOf(choices, 'M1')).toBe("Lower than the chart's timeframe — coming next");
    expect(reasonOf(choices, 'M4')).toBe("Lower than the chart's timeframe — coming next");
    expect(reasonOf(choices, CHART_TIMEFRAME)).toBeUndefined();
    expect(reasonOf(choices, 'H1')).toBeUndefined();
  });
});

test.describe('grouping the chart bars into a higher timeframe', () => {
  const SEVEN_MINUTES: readonly RenderBar[] = [
    minuteBar(0, { open: 10, high: 12, low: 9, close: 11 }, 5),
    minuteBar(1, { open: 11, high: 15, low: 10, close: 14 }, 6),
    minuteBar(2, { open: 14, high: 14, low: 8, close: 9 }, 7),
    minuteBar(3, { open: 9, high: 13, low: 9, close: 12 }, 8),
    minuteBar(4, { open: 12, high: 16, low: 11, close: 13 }, 9),
    minuteBar(5, { open: 13, high: 18, low: 12, close: 17 }, 10),
    minuteBar(6, { open: 17, high: 19, low: 16, close: 18 }, 11),
  ];

  test('seven M1 bars become one whole and one forming M5 bar of their own prices and volume', () => {
    const { bars, bucketOf } = bucketBars(SEVEN_MINUTES, 'M5');

    expect(bucketOf).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(bars).toEqual([
      { time: FIRST_BAR_SECONDS, open: 10, high: 16, low: 8, close: 13, volume: 35 },
      { time: FIRST_BAR_SECONDS + SECONDS_PER_M5, open: 13, high: 19, low: 12, close: 18, volume: 21 },
    ]);
  });

  test('a higher-timeframe bar starts on its grid, the weekly and monthly ones on their calendar boundary', () => {
    const threeDaysLater = FIRST_BAR_SECONDS + 3 * SECONDS_PER_DAY;

    expect(higherTimeframeBarTime('M5', FIRST_BAR_SECONDS + 7 * SECONDS_PER_MINUTE)).toBe(
      FIRST_BAR_SECONDS + SECONDS_PER_M5,
    );
    expect(higherTimeframeBarTime('W1', threeDaysLater)).toBe(Date.UTC(2023, 10, 13) / MILLISECONDS_PER_SECOND);
    expect(higherTimeframeBarTime('MN1', threeDaysLater)).toBe(Date.UTC(2023, 10, 1) / MILLISECONDS_PER_SECOND);
  });
});

test.describe('projecting a higher-timeframe frame onto the chart bars', () => {
  /** Six M1 bars: five fill the first M5 bar and the sixth opens the one still forming. */
  const SIX_MINUTES: readonly RenderBar[] = [5, 6, 7, 8, 9, 10].map((close, index) =>
    minuteBar(index, { open: close, high: close, low: close, close }, 1),
  );
  const FIVE_MINUTE_BARS = bucketBars(SIX_MINUTES, 'M5');
  const FIVE_MINUTE_FRAME: IndicatorFrame = {
    plots: [{ title: 'value', style: 'line', color: '#26a69a', lineWidth: 1 }],
    bars: [
      { timeMs: FIVE_MINUTE_BARS.bars[0].time * MILLISECONDS_PER_SECOND, confirmed: true, values: [10] },
      { timeMs: FIVE_MINUTE_BARS.bars[1].time * MILLISECONDS_PER_SECOND, confirmed: false, values: [20] },
    ],
  };

  /** The two-bucket frame written onto the six chart bars, read the way `source` says. */
  function projectedValues(source: 'its-bucket' | 'last-closed-bucket'): (number | null)[] {
    const frame = projectHigherTimeframeFrame(
      FIVE_MINUTE_FRAME,
      { chartBars: SIX_MINUTES, bucketOf: FIVE_MINUTE_BARS.bucketOf },
      source,
    );
    return frame.map((bar) => bar.values[0]);
  }

  test('every chart bar takes the value of the bucket it falls in, the forming bucket included', () => {
    expect(projectedValues('its-bucket')).toEqual([10, 10, 10, 10, 10, 20]);
  });

  test('a chart bar keeps the last closed bucket, so the step follows the close and not the forming bar', () => {
    expect(projectedValues('last-closed-bucket')).toEqual([null, null, null, null, null, 10]);
  });

  test('a projected bar is the chart bar, forming only where the chart still draws it', () => {
    const frame = projectHigherTimeframeFrame(
      FIVE_MINUTE_FRAME,
      { chartBars: SIX_MINUTES, bucketOf: FIVE_MINUTE_BARS.bucketOf },
      'its-bucket',
    );

    expect(frame.map((bar) => bar.timeMs)).toEqual(SIX_MINUTES.map((bar) => bar.time * MILLISECONDS_PER_SECOND));
    expect(frame.map((bar) => bar.confirmed)).toEqual([true, true, true, true, true, false]);
  });
});

test.describe('an SMA calculated on a higher timeframe', () => {
  const BARS_PER_HOUR = SECONDS_PER_HOUR / SECONDS_PER_M5;
  const HOURS = 3;
  /** Three whole hours of M5 bars, whose closes rise by one every bar. */
  const THREE_HOURS_OF_M5: readonly RenderBar[] = Array.from({ length: HOURS * BARS_PER_HOUR }, (_, index) =>
    m5Bar(index, 100 + index),
  );
  const HOURLY_BARS = bucketBars(THREE_HOURS_OF_M5, 'H1');
  const HOURLY_SMA = averageOf(
    HOURLY_BARS.bars.map((bar) => bar.close),
    SAVED_LENGTH,
  );

  /** The H1 SMA settings these cases calculate with, under the wait switch they ask for. */
  function smaSettings(waitForCloses: boolean): SettingValues {
    const stored = { length: SAVED_LENGTH, calculationTimeframe: 'H1', [WAIT_FOR_CLOSES_INPUT]: waitForCloses };
    return calculationSettings(stored);
  }

  test('its values are the SMA of the grouped H1 bars, written onto the M5 bars that fall in them', () => {
    const frame = new HigherTimeframeIndicator(smaPlugin.indicatorClass).load(
      THREE_HOURS_OF_M5,
      smaSettings(false),
      CHART_TIMEFRAME,
    );

    expect(frame.bars.map((bar) => bar.timeMs)).toEqual(
      THREE_HOURS_OF_M5.map((bar) => bar.time * MILLISECONDS_PER_SECOND),
    );
    expect(frame.bars.map((bar) => bar.values[0])).toEqual(
      HOURLY_BARS.bucketOf.map((bucketIndex) => HOURLY_SMA[bucketIndex]),
    );
  });

  test('waiting for the hourly close holds every chart bar on the hour before it', () => {
    const frame = new HigherTimeframeIndicator(smaPlugin.indicatorClass).load(
      THREE_HOURS_OF_M5,
      smaSettings(true),
      CHART_TIMEFRAME,
    );

    expect(frame.bars.map((bar) => bar.values[0])).toEqual(
      HOURLY_BARS.bucketOf.map((bucketIndex) => HOURLY_SMA[bucketIndex - 1] ?? null),
    );
  });

  test('a tick rewrites the M5 bars of the forming hour and no older one', () => {
    const formingBar = THREE_HOURS_OF_M5[THREE_HOURS_OF_M5.length - 1];
    const tickBar = { ...formingBar, close: formingBar.close + TICK_OFFSET };
    const indicator = new HigherTimeframeIndicator(smaPlugin.indicatorClass);
    indicator.load(THREE_HOURS_OF_M5, smaSettings(false), CHART_TIMEFRAME);

    const updated = indicator.update(tickBar, smaSettings(false));
    const fresh = new HigherTimeframeIndicator(smaPlugin.indicatorClass).load(
      [...THREE_HOURS_OF_M5.slice(0, -1), tickBar],
      smaSettings(false),
      CHART_TIMEFRAME,
    );
    const formingHourIndex = HOURLY_BARS.bucketOf.indexOf(HOURLY_BARS.bars.length - 1);

    expect(updated.bars).toEqual(fresh.bars.slice(formingHourIndex));
  });
});

/** Opens the settings dialog of the saved moving average, through the object tree row that offers it. */
async function openSmaSettings(page: Page): Promise<Locator> {
  await openWithSavedIndicators(page, [SAVED_SMA]);
  await openObjectTree(page);
  const row = indicatorRows(page);
  await row.hover();
  await row.getByRole('button', { name: 'Indicator settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: SMA_DIALOG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The Calculation section of an indicator's Inputs tab. */
function calculationGroup(dialog: Locator): Locator {
  return dialog.getByRole('group', { name: 'Calculation', exact: true });
}

/** The values the layer draws for the first plot, in chart bar order. */
async function drawnValues(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__chartTest!.indicators()[0]?.plots[0]?.points.map((point) => point.value) ?? []);
}

test('the Inputs tab carries the Calculation section with the Chart timeframe and the wait switch', async ({
  page,
}) => {
  const group = calculationGroup(await openSmaSettings(page));

  await expect(group).toBeVisible();
  await expect(group.getByLabel('Timeframe', { exact: true })).toHaveText('Chart');
  await expect(group.getByRole('checkbox', { name: 'Wait for timeframe closes', exact: true })).toBeChecked();

  await group.getByRole('button', { name: 'Info', exact: true }).hover();
  await expect(page.locator('.drawing-settings-tooltip-bubble')).toHaveText(CALCULATION_TIMEFRAME_TOOLTIP);
});

test('the drop-down offers the tick and shorter timeframes disabled, each with the reason in its title', async ({
  page,
}) => {
  const group = calculationGroup(await openSmaSettings(page));
  await group.getByLabel('Timeframe', { exact: true }).click();

  const tickChoice = page.getByRole('option', { name: '1 tick', exact: true });
  await expect(tickChoice).toHaveAttribute('aria-disabled', 'true');
  await expect(tickChoice).toHaveAttribute('title', 'Needs tick data — coming next');

  const shorterChoice = page.getByRole('option', { name: SHORTER_CHOICE_LABEL, exact: true });
  await expect(shorterChoice).toHaveAttribute('aria-disabled', 'true');
  await expect(shorterChoice).toHaveAttribute('title', "Lower than the chart's timeframe — coming next");

  for (const label of [CHART_CHOICE_LABEL, HIGHER_CHOICE_LABEL]) {
    await expect(page.getByRole('option', { name: label, exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  }
});

test('saving a higher timeframe renames the legend and draws the values of the grouped bars', async ({ page }) => {
  const dialog = await openSmaSettings(page);
  await calculationGroup(dialog).getByLabel('Timeframe', { exact: true }).click();
  await page.getByRole('option', { name: HIGHER_CHOICE_LABEL, exact: true }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await attachedIndicators(page))[0]?.settings[CALCULATION_TIMEFRAME_INPUT])
    .toBe(HIGHER_CHOICE);
  const saved = readSavedIndicators(await latestSavedIndicators(page));
  expect(saved?.[0]?.settings[CALCULATION_TIMEFRAME_INPUT]).toBe(HIGHER_CHOICE);

  const legendRows = page.getByLabel('Indicator legend', { exact: true }).locator('.chart-indicator-legend-row');
  await expect(legendRows.first()).toContainText(`${SAVED_NAME} ${HIGHER_CHOICE_LABEL}`);

  const chartBars = await page.evaluate(() => window.__chartTest!.data());
  const grouped = bucketBars(chartBars, HIGHER_CHOICE);
  const groupedSma = averageOf(
    grouped.bars.map((bar) => bar.close),
    SAVED_LENGTH,
  );
  // The wait switch is on, so every chart bar shows the last M15 bar that closed before it.
  const waitedValues = grouped.bucketOf.map((bucketIndex) => groupedSma[bucketIndex - 1] ?? null);
  await expect.poll(() => drawnValues(page)).toEqual(waitedValues.filter((value) => value !== null));
  expect(await drawnValues(page)).not.toEqual(
    averageOf(
      chartBars.map((bar) => bar.close),
      SAVED_LENGTH,
    ).filter((value) => value !== null),
  );
});
