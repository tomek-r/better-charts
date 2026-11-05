import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_ID,
  FAST_PLOT,
  drawnIndicators,
  frameOf,
  openChartTimes,
  paneCount,
  removeIndicator,
  showFrame,
} from './helpers/indicatorFrames';

/** The id an own-pane test shows the same indicator under twice. */
const OSC_ID = 'osc';
/** How many frames the second own-pane test shows before it checks the pane. */
const SHOW_COUNT = 2;
/** The two own-pane indicators of the removal test. */
const FIRST_ID = 'a';
const SECOND_ID = 'b';
/** The ids of the precision test: one frame asks for decimals, the other leaves it to the default. */
const PRECISE_ID = 'precise';
const PLAIN_ID = 'plain';
/** The panes a chart holds: the price pane first, then one pane per own-pane indicator. */
const PRICE_PANE_COUNT = 1;
const TWO_PANES = 2;
const THREE_PANES = 3;
/** The indexes those panes get, counted from the price pane down. */
const PRICE_PANE_INDEX = 0;
const FIRST_OWN_PANE_INDEX = 1;
const SECOND_OWN_PANE_INDEX = 2;
/** The decimals a frame carrying its own precision asks its pane to show. */
const FORMATTED_PRECISION = 2;

/** A one-plot frame over `times` that plots the bar index, so every value is easy to read back. */
function frameFor(times: readonly number[]) {
  return frameOf([FAST_PLOT], times, (_plot, bar) => bar);
}

/** The one oscillator sits in the single pane under the price pane. */
async function expectOscillatorInItsOwnPane(page: Page): Promise<void> {
  expect(await paneCount(page)).toBe(TWO_PANES);
  expect((await drawnIndicators(page))[0].paneIndex).toBe(FIRST_OWN_PANE_INDEX);
}

test('an own-pane indicator gets a pane under the price pane', async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(page, OSC_ID, frameFor(times), 'own');

  await expectOscillatorInItsOwnPane(page);
});

test('showing it again keeps its pane', async ({ page }) => {
  const times = await openChartTimes(page);

  for (let shown = 0; shown < SHOW_COUNT; shown += 1) {
    await showFrame(page, OSC_ID, frameFor(times), 'own');
  }

  await expectOscillatorInItsOwnPane(page);
});

test('each own-pane indicator gets its own pane and removing one closes up the rest', async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(page, FIRST_ID, frameFor(times), 'own');
  await showFrame(page, SECOND_ID, frameFor(times), 'own');

  const shown = await drawnIndicators(page);
  expect(shown.find((indicator) => indicator.id === FIRST_ID)?.paneIndex).toBe(FIRST_OWN_PANE_INDEX);
  expect(shown.find((indicator) => indicator.id === SECOND_ID)?.paneIndex).toBe(SECOND_OWN_PANE_INDEX);
  expect(await paneCount(page)).toBe(THREE_PANES);

  await removeIndicator(page, FIRST_ID);

  expect(await paneCount(page)).toBe(TWO_PANES);
  const remaining = await drawnIndicators(page);
  expect(remaining.find((indicator) => indicator.id === SECOND_ID)?.paneIndex).toBe(FIRST_OWN_PANE_INDEX);

  await removeIndicator(page, SECOND_ID);

  expect(await paneCount(page)).toBe(PRICE_PANE_COUNT);
});

test('an overlay indicator stays on the price pane', async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(page, DEMO_ID, frameFor(times));

  expect(await paneCount(page)).toBe(PRICE_PANE_COUNT);
  expect((await drawnIndicators(page))[0].paneIndex).toBe(PRICE_PANE_INDEX);
});

test("a frame's precision formats its pane", async ({ page }) => {
  const times = await openChartTimes(page);

  await showFrame(page, PRECISE_ID, { ...frameFor(times), precision: FORMATTED_PRECISION }, 'own');
  await showFrame(page, PLAIN_ID, frameFor(times), 'own');

  const shown = await drawnIndicators(page);
  expect(shown.find((indicator) => indicator.id === PRECISE_ID)?.precision).toBe(FORMATTED_PRECISION);
  expect(shown.find((indicator) => indicator.id === PLAIN_ID)?.precision).toBeNull();
});
