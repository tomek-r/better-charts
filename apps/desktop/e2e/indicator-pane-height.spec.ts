import { expect, test, type Page } from '@playwright/test';
import { CHART_HOST_SELECTOR, paneSeparatorCenter } from './helpers/chartHost';
import { drawnIndicators } from './helpers/indicatorFrames';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { savedOverrides } from './helpers/savedOverrides';

const RSI_INSTANCE_ID = 'rsi-1';
const SAVED_RSI = { instanceId: RSI_INSTANCE_ID, definitionId: 'rsi', settings: {} };
/**
 * The height a fresh indicator pane takes relative to the price pane: its stretch factor of 0.25 against the
 * factor of 2 the library starts the price pane at.
 */
const DEFAULT_PANE_HEIGHT = 0.125;
const SAVED_PANE_HEIGHT = 0.5;
/** How far up the separator is dragged, which makes the RSI pane taller. */
const DRAG_UP_PX = 60;
const DRAG_STEPS = 5;
/** A point inside the price pane, away from the legend and the separator. */
const PRICE_PANE_CLICK = { x: 200, y: 100 };

failOnPageNoise();

/** The RSI pane's height relative to the price pane, once the layer draws it. */
async function rsiPaneHeight(page: Page): Promise<number | null | undefined> {
  const indicators = await drawnIndicators(page);
  return indicators.find((indicator) => indicator.id === RSI_INSTANCE_ID)?.paneHeight;
}

/** The pane height the latest saved overrides store for the RSI, if any. */
async function storedRsiPaneHeight(page: Page): Promise<unknown> {
  const indicators = await latestSavedIndicators(page);
  if (!Array.isArray(indicators)) {
    return undefined;
  }
  const rsi: unknown = indicators.find(
    (entry: unknown) =>
      typeof entry === 'object' && entry !== null && 'instanceId' in entry && entry.instanceId === RSI_INSTANCE_ID,
  );
  return typeof rsi === 'object' && rsi !== null && 'paneHeight' in rsi ? rsi.paneHeight : undefined;
}

async function expectRsiPaneHeight(page: Page, expected: number, digits: number): Promise<void> {
  await expect.poll(async () => (await rsiPaneHeight(page)) ?? Number.NaN).toBeCloseTo(expected, digits);
}

test('a saved pane height is restored when the chart loads', async ({ page }) => {
  await openWithSavedIndicators(page, [{ ...SAVED_RSI, paneHeight: SAVED_PANE_HEIGHT }]);

  await expectRsiPaneHeight(page, SAVED_PANE_HEIGHT, 2);
});

test('a pane never resized takes the default height', async ({ page }) => {
  await openWithSavedIndicators(page, [SAVED_RSI]);

  await expectRsiPaneHeight(page, DEFAULT_PANE_HEIGHT, 2);
});

test('dragging the separator stores the height the pane is given', async ({ page }) => {
  await openWithSavedIndicators(page, [SAVED_RSI]);
  await expectRsiPaneHeight(page, DEFAULT_PANE_HEIGHT, 2);

  const start = await paneSeparatorCenter(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - DRAG_UP_PX, { steps: DRAG_STEPS });
  await page.mouse.up();

  await expect.poll(async () => storedRsiPaneHeight(page)).toBeGreaterThan(DEFAULT_PANE_HEIGHT);
  const stored = await storedRsiPaneHeight(page);
  if (typeof stored !== 'number') {
    throw new Error('The dragged pane height was not stored.');
  }
  await expectRsiPaneHeight(page, stored, 3);
});

test('a click on the chart stores nothing', async ({ page }) => {
  await openWithSavedIndicators(page, [SAVED_RSI]);
  await expectRsiPaneHeight(page, DEFAULT_PANE_HEIGHT, 2);
  const host = await page.locator(CHART_HOST_SELECTOR).boundingBox();
  if (host === null) {
    throw new Error('The chart host is not laid out.');
  }
  const savedBefore = (await savedOverrides(page)).length;

  await page.mouse.click(host.x + PRICE_PANE_CLICK.x, host.y + PRICE_PANE_CLICK.y);

  expect((await savedOverrides(page)).length).toBe(savedBefore);
});
