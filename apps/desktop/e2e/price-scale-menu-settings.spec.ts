import { expect, test, type Page } from '@playwright/test';
import { assembleGlyphRows, observeFillText, type AxisPaint } from './helpers/canvasText';
import { openChartMenu } from './helpers/chartMenu';
import { openChartSettingsTab } from './helpers/chartSettingsDialog';
import {
  chartScopeKey,
  eurusdQuote,
  expectNoErrors,
  gotoWithStub,
  pushEvent,
  STUB_NOW,
  stubChartSettingOverrides,
  stubInvocations,
} from './helpers/tauriStub';

/**
 * The price scale menu's saved values: which way the scale grows, how it spaces its prices, and the
 * symbol name tag. All three are saved with the chart's scales settings and applied to the engine, but
 * the Scales and lines tab draws none of them — only the gear menu of the next slice offers them.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** The bars the stub's snapshot holds. */
const STUB_BAR_COUNT = 10;
/** `PriceScaleMode.Logarithmic` and `PriceScaleMode.Normal`, as the library's own options report them. */
const LOGARITHMIC_MODE = 1;
const REGULAR_MODE = 0;
/** A Bid high in the pane, which leaves room under the countdown tag for the symbol tag. */
const HIGH_BID = '1.08540';
const HIGH_ASK = '1.08545';

/** The price scale as the library holds it, read back through the DEV test hook. */
function priceScale(page: Page) {
  return page.evaluate(() => window.__chartTest!.priceScale());
}

/** What the chart draws of its scales settings right now. */
function scales(page: Page) {
  return page.evaluate(() => window.__chartTest!.scales());
}

/** The saved shape and symbol tag as the chart draws them: the library's options beside the engine's state. */
async function scaleShape(page: Page) {
  const [library, state] = await Promise.all([priceScale(page), scales(page)]);
  return {
    mode: library.mode,
    invertScale: { library: library.invertScale, engine: state.invertScale },
    priceScaleMode: state.priceScaleMode,
    symbolNameLabel: state.symbolNameLabelVisible,
  };
}

/** The overrides every `save_chart_setting_overrides` call carried, oldest first. */
async function savedOverrides(page: Page): Promise<unknown[]> {
  const calls = (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_setting_overrides');
  return calls.map((entry) => entry.args.overrides);
}

/** Waits for the stub's ten bars, so the chart has candles to scale. */
async function openChart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);
}

/** Moves the pointer onto the right price axis, which reveals the A and L row. */
async function hoverPriceAxis(page: Page): Promise<void> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.move(host.x + host.width - 20, host.y + host.height / 2);
}

/** Opens the chart menu and clicks the view command it offers. */
async function resetChartView(page: Page): Promise<void> {
  const menu = await openChartMenu(page);
  await menu.getByRole('menuitem', { name: /Reset chart view/ }).click();
}

interface AxisPaints {
  __axisPaints?: AxisPaint[];
}

/**
 * Records every text draw on the price-axis canvas. The axis is the chart's narrow, tall canvas, and
 * its tags draw one glyph per cell, which `assembleGlyphRows` reassembles into the text a tag wrote.
 */
async function observePriceAxisText(page: Page): Promise<void> {
  await observeFillText(page, () => {
    const paints: AxisPaint[] = [];
    (window as unknown as AxisPaints).__axisPaints = paints;
    // CSS pixels: beside the pane canvas the price axis is the narrow, tall one.
    const axisMaxCssWidth = 120;
    const axisMinCssHeight = 120;
    const onPriceAxis = (context: CanvasRenderingContext2D) =>
      context.canvas.width <= axisMaxCssWidth * devicePixelRatio &&
      context.canvas.height > axisMinCssHeight * devicePixelRatio;
    return (context, text, x, y) => {
      if (onPriceAxis(context)) {
        paints.push({ text: String(text), at: performance.now(), x, y });
      }
    };
  });
}

/** Every price-axis tag the canvas has written, its glyph cells reassembled into one text per row. */
async function tagTexts(page: Page): Promise<string[]> {
  const paints = await page.evaluate(() => (window as unknown as AxisPaints).__axisPaints ?? []);
  return assembleGlyphRows(paints).map((row) => row.text);
}

test('a default chart draws a regular, upward price scale and no symbol tag', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);

  expect(await scaleShape(page)).toEqual({
    mode: REGULAR_MODE,
    invertScale: { library: false, engine: false },
    priceScaleMode: 'regular',
    symbolNameLabel: false,
  });
  expectNoErrors(collected);
});

test('the L toggle saves the price scale mode it asks for instead of writing the scale', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await hoverPriceAxis(page);
  const logButton = page.getByRole('button', { name: /^Logarithmic/ });

  await logButton.click();
  await expect.poll(async () => (await priceScale(page)).mode).toBe(LOGARITHMIC_MODE);
  await expect(logButton).toHaveAttribute('aria-pressed', 'true');
  const logarithmic = { scales: { priceScaleMode: 'logarithmic' } };
  expect(await savedOverrides(page)).toEqual([logarithmic]);
  expect(await stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: logarithmic });

  // Asking for the regular scale again leaves nothing to store, so the chart falls back to its template.
  await logButton.click();
  await expect.poll(async () => (await priceScale(page)).mode).toBe(REGULAR_MODE);
  await expect(logButton).toHaveAttribute('aria-pressed', 'false');
  expect(await savedOverrides(page)).toEqual([logarithmic, {}]);
  expect(await stubChartSettingOverrides(page)).toEqual({});
  expectNoErrors(collected);
});

test('saved scale shape overrides reach the chart: inverted, logarithmic and the symbol tag', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: {
      [EURUSD_CHART]: { scales: { invertScale: true, priceScaleMode: 'logarithmic', symbolNameLabel: true } },
    },
  });
  await openChart(page);

  await expect
    .poll(async () => scaleShape(page))
    .toEqual({
      mode: LOGARITHMIC_MODE,
      invertScale: { library: true, engine: true },
      priceScaleMode: 'logarithmic',
      symbolNameLabel: true,
    });
  expectNoErrors(collected);
});

test('the Scales and lines tab draws none of the gear menu rows', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  const dialog = await openChartSettingsTab(page, 'Scales and lines');

  await expect(dialog.getByRole('checkbox', { name: 'Invert scale', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Symbol name label', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Scale type', exact: true })).toHaveCount(0);
  for (const name of ['Invert scale', 'Scale type', 'Symbol name label']) {
    await expect(dialog.getByText(name, { exact: true })).toHaveCount(0);
  }
  expectNoErrors(collected);
});

test('Reset chart view fits the price scale to the data again after A turned that off', async ({ page }) => {
  const collected = await gotoWithStub(page);
  await openChart(page);
  await resetChartView(page);
  await expect.poll(async () => (await priceScale(page)).autoScale).toBe(true);

  await hoverPriceAxis(page);
  const autoButton = page.getByRole('button', { name: /^Auto scale/ });
  await autoButton.click();
  await expect.poll(async () => (await priceScale(page)).autoScale).toBe(false);

  await resetChartView(page);
  await expect.poll(async () => (await priceScale(page)).autoScale).toBe(true);
  await expect(autoButton).toHaveAttribute('aria-pressed', 'true');
  expectNoErrors(collected);
});

test('the symbol name label writes the symbol under the countdown tag when it is on', async ({ page }) => {
  await observePriceAxisText(page);
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { scales: { symbolNameLabel: true } } },
  });
  await openChart(page);
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 15_500, HIGH_BID, HIGH_ASK));

  await expect.poll(async () => (await tagTexts(page)).includes('EURUSD')).toBe(true);
  expectNoErrors(collected);
});

test('a chart whose symbol name label is off writes no symbol tag', async ({ page }) => {
  await observePriceAxisText(page);
  const collected = await gotoWithStub(page);
  await openChart(page);
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + 15_500, HIGH_BID, HIGH_ASK));

  // The quote tags are painted, so the axis is drawing: only the symbol tag is missing.
  await expect.poll(async () => (await tagTexts(page)).length).toBeGreaterThan(0);
  expect(await tagTexts(page)).not.toContain('EURUSD');
  expectNoErrors(collected);
});
