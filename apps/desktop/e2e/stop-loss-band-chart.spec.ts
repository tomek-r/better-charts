import { expect, test, type Page } from '@playwright/test';
import { pushEvent, STUB_NOW, stubInvocations } from './helpers/tauriStub';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { fillExitPrice, openTradePanel } from './helpers/panel';
import { decodePng, pixelAt } from './helpers/pngPixels';
import { clampStopLoss } from '../src/features/chart/engine/trading/slBand';
import { layoutLabelCenters } from '../src/features/chart/engine/trading/labels/layoutLabelCenters';

// The minimum 0.1 lot spends the 6.25 USD budget at 104 ticks from the 1.0850 ask.
// BUY market stop distance is measured from the 1.0846 bid: 21 ticks -> 1.08439.
const FAR_EDGE = '1.08396';
const NEAR_EDGE = '1.08439';

interface BandGeometry {
  labels: Array<{ level: string; lineY: number; box: { x: number; y: number; w: number; h: number } }>;
  entryLineY: number | null;
  slHandle: { x: number; y: number; w: number; h: number } | null;
  slBand: { nearPrice: number; farPrice: number; empty: boolean } | null;
  slBandY: { nearY: number; farY: number } | null;
  slClampHint: string | null;
  slClampEdge: 'near' | 'far' | null;
  slBandLabels: Array<{
    edge: 'near' | 'far';
    text: string;
    held: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  slMoney: string | null;
  container: { left: number; top: number; width: number; height: number };
  chartRect: { x: number; y: number; width: number; height: number } | null;
  priceRange: { min: number; max: number } | null;
}
async function geometry(page: Page): Promise<BandGeometry> {
  return page.evaluate(() => {
    const w = window as unknown as { __stagedWidgetTest: { geometry(): unknown } };
    return w.__stagedWidgetTest.geometry() as BandGeometry;
  });
}
/** The SL money label as a magnitude: the display minus is typographic, which `Number` does not read. */
const slMoneyMagnitude = async (page: Page): Promise<number> =>
  Math.abs(Number(((await geometry(page)).slMoney ?? '').replace('−', '').replace(' USD', '')));
type Box = { x: number; y: number; w: number; h: number };
const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** `limit` stages a buy limit at that price and the SL / TP at the given prices instead of the market defaults. */
interface StageOptions {
  limit?: { entry: string; stopLoss: string; takeProfit: string };
}
async function stageRiskOrder(page: Page, mode: 'Risk, % equity' | 'Units', options: StageOptions = {}) {
  const collected = await gotoRiskBandStub(page);
  await openTradePanel(page);
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: mode }).click();
  if (mode !== 'Units') {
    await page.getByLabel('Risk percent', { exact: true }).fill('5');
  }
  const { limit } = options;
  if (limit) {
    await page.locator('.ticket-type-tab', { hasText: 'Limit' }).first().click();
    await page.getByLabel('Order price').fill(limit.entry);
    await fillExitPrice(page, 'Take profit', limit.takeProfit);
  }
  await fillExitPrice(page, 'Stop loss', limit?.stopLoss ?? '1.0840');
  // The unset SL handle floats beside the entry; wait until it has moved onto the typed SL line.
  await expect
    .poll(async () => {
      const geo = await geometry(page);
      return limit
        ? geo.slBandLabels.length === 2
        : geo.slHandle !== null && geo.entryLineY !== null && geo.slHandle.y > geo.entryLineY + 40;
    })
    .toBe(true);
  // The price scale refits once the typed SL enters the autoscale range; wait for the picture to stop moving.
  let previous = '';
  await expect
    .poll(async () => {
      const current = JSON.stringify((await geometry(page)).slBandY);
      const settled = current === previous;
      previous = current;
      await page.waitForTimeout(150);
      return settled;
    })
    .toBe(true);
  return collected;
}
/** Presses on the SL handle and drags it `below` px under the far edge (or under the handle in units mode). */
async function dragSlHandle(page: Page, dropY: (geo: BandGeometry) => number, alt = false) {
  const geo = await geometry(page);
  const handle = geo.slHandle!;
  const start = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  await page.mouse.move(start.x, start.y);
  if (alt) {
    await page.keyboard.down('Alt');
  }
  await page.mouse.down();
  await page.mouse.move(start.x, dropY(geo), { steps: 10 });
  return async () => {
    await page.mouse.up();
    if (alt) {
      await page.keyboard.up('Alt');
    }
  };
}

/**
 * Band texts are plain muted text at the right end of their dotted line, right-aligned just left of the price
 * axis, on the side of the line OUTSIDE the allowed zone (Min SL toward the entry, Max SL beyond the far edge)
 * and within a few px of the line. Because they sit on opposite sides they can never overlap each other.
 */
function expectBandTextBesideItsLine(geo: BandGeometry) {
  const rightEdge = geo.chartRect!.x + geo.chartRect!.width;
  const downward = geo.slBandY!.farY > geo.slBandY!.nearY;
  for (const item of geo.slBandLabels) {
    const lineY = item.edge === 'far' ? geo.slBandY!.farY : geo.slBandY!.nearY;
    const outward = (item.edge === 'far') === downward ? 1 : -1;
    const centre = item.y + item.h / 2;
    expect(rightEdge - (item.x + item.w)).toBeGreaterThanOrEqual(2);
    expect(rightEdge - (item.x + item.w)).toBeLessThanOrEqual(12);
    expect((centre - lineY) * outward).toBeGreaterThan(0);
    expect(Math.abs(centre - lineY)).toBeLessThanOrEqual(14);
  }
  const [first, second] = geo.slBandLabels;
  expect(Math.abs(first.x + first.w - (second.x + second.w))).toBeLessThanOrEqual(0.5);
}
/** Handle labels keep the pre-band layout: spaced from each other only, as if the band did not exist. */
function expectHandleLabelsIgnoreBand(geo: BandGeometry) {
  const rows = [...geo.labels].sort((a, b) => a.lineY - b.lineY);
  const { y, height } = geo.chartRect!;
  const expected = layoutLabelCenters(
    rows.map((row) => row.lineY),
    y,
    y + height,
  );
  rows.forEach((row, i) => {
    expect(Math.abs(row.box.y + row.box.h / 2 - expected[i])).toBeLessThanOrEqual(1);
  });
}

test('the entry and SL handle labels sit on their line price with the band present, even with Min SL beside the entry', async ({
  page,
}) => {
  await stageRiskOrder(page, 'Risk, % equity');
  await expect.poll(async () => (await geometry(page)).slBandLabels.length).toBe(2);
  for (const sl of ['1.0840', NEAR_EDGE]) {
    await page.getByLabel('Stop loss price').fill(sl);
    await expect(page.getByLabel('Stop loss price')).toHaveValue(sl);
    await page.waitForTimeout(400);
    const geo = await geometry(page);
    expect(geo.slBandLabels).toHaveLength(2);
    expectHandleLabelsIgnoreBand(geo);
    // Only the unset TP handle floating 30px from the entry may displace it: never the band texts.
    const entry = geo.labels.find((row) => row.level === 'entry')!;
    const floating = geo.labels.filter((row) => row.level !== 'entry' && Math.abs(row.lineY - entry.lineY) < 40);
    if (floating.length === 0) {
      expect(Math.abs(entry.box.y + entry.box.h / 2 - entry.lineY)).toBeLessThanOrEqual(1);
    }
  }
});

test('risk % mode marks both band edges with a dotted line and a permanent neutral label, nothing shaded', async ({
  page,
}, testInfo) => {
  await stageRiskOrder(page, 'Risk, % equity');
  await expect.poll(async () => (await geometry(page)).slBand?.farPrice).toBeCloseTo(Number(FAR_EDGE), 8);
  await expect.poll(async () => (await geometry(page)).slBandLabels.length).toBe(2);
  const geo = await geometry(page);
  expect(geo.slBand?.nearPrice).toBeCloseTo(Number(NEAR_EDGE), 8);
  expect(geo.slBandY!.farY).toBeGreaterThan(geo.slBandY!.nearY);
  const label = (edge: 'near' | 'far') => geo.slBandLabels.find((item) => item.edge === edge)!;
  expect(label('far').text).toBe('Max SL');
  expect(label('near').text).toBe('Min SL');
  expectBandTextBesideItsLine(geo);
  for (const edge of ['far', 'near'] as const) {
    for (const row of geo.labels) {
      expect(boxesOverlap(label(edge), row.box)).toBe(false);
    }
    expect(boxesOverlap(label(edge), geo.slHandle!)).toBe(false);
  }
  expect(boxesOverlap(label('far'), label('near'))).toBe(false);
  // No shading: the pane below the far edge is the same plain background as the pane above the entry.
  const image = decodePng(await page.locator('.chart-host').screenshot());
  const sampleX = Math.round(geo.chartRect!.x - geo.container.left + geo.chartRect!.width * 0.3);
  const colorAt = (pageY: number) => pixelAt(image, sampleX, Math.round(pageY - geo.container.top));
  expect(colorAt(geo.slBandY!.farY + 30)).toEqual(colorAt(geo.entryLineY! - 80));
  await page.locator('.chart-host').screenshot({ path: testInfo.outputPath('sl-band.png') });
});

test('an SL sitting on a band edge keeps its handle on the line and never meets the band text', async ({
  page,
}, testInfo) => {
  await stageRiskOrder(page, 'Risk, % equity');
  for (const price of [FAR_EDGE, NEAR_EDGE]) {
    await page.getByLabel('Stop loss price').fill(price);
    await expect(page.getByLabel('Stop loss price')).toHaveValue(price);
    await page.waitForTimeout(400);
    const geo = await geometry(page);
    expect(geo.slBandLabels).toHaveLength(2);
    expectHandleLabelsIgnoreBand(geo);
    expectBandTextBesideItsLine(geo);
    for (const item of geo.slBandLabels) {
      for (const row of geo.labels) {
        expect(boxesOverlap(item, row.box)).toBe(false);
      }
    }
  }
  await page.locator('.chart-host').screenshot({ path: testInfo.outputPath('sl-band-labels.png') });
});

test('the band labels are not handles: pressing one neither drags the SL nor steals the SL grab', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity');
  await expect.poll(async () => (await geometry(page)).slBandLabels.length).toBe(2);
  const geo = await geometry(page);
  const far = geo.slBandLabels.find((item) => item.edge === 'near')!;
  await page.mouse.move(far.x + far.w / 2, far.y + far.h / 2);
  await page.mouse.down();
  await page.mouse.move(far.x + far.w / 2, far.y + far.h / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel('Stop loss price')).toHaveValue('1.0840');
  expect((await geometry(page)).slClampEdge).toBeNull();
  // The SL handle still grabs even though the near edge label is on the screen.
  const release = await dragSlHandle(page, (current) => current.slBandY!.nearY + 20);
  await expect.poll(async () => Number(await page.getByLabel('Stop loss price').inputValue())).not.toBe(1.084);
  await release();
});

test('dragging the SL past the far edge stops at the edge price and explains why', async ({ page }, testInfo) => {
  const collected = await stageRiskOrder(page, 'Risk, % equity');
  // Broker answer for the typed 1.0840 stop: 100 ticks x 0.6 USD x 0.1 lot = 6.00 USD of the 6.25 USD budget.
  await expect
    .poll(async () => (await stubInvocations(page)).filter((c) => c.cmd === 'request_risk_preview').length)
    .toBeGreaterThan(0);
  const request = (await stubInvocations(page)).filter((c) => c.cmd === 'request_risk_preview').at(-1)!;
  await pushEvent(page, 'risk-preview', {
    ...request.args,
    riskBudget: '6.25',
    volume: '0.10',
    estimatedRisk: '6.00',
    estimatedMargin: '10',
    estimatedReward: null,
    rr: null,
    currency: 'USD',
    quotedAtMs: STUB_NOW,
  });
  await expect.poll(async () => (await geometry(page)).slMoney).toBe('−6.00 USD');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.farY + 50);
  await expect(page.getByLabel('Stop loss price')).toHaveValue(FAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampEdge).toBe('far');
  // Only the clamped edge's text is emphasised.
  await expect
    .poll(async () => (await geometry(page)).slBandLabels.map((item) => `${item.edge}:${item.held}`).sort())
    .toEqual(['far:true', 'near:false']);
  await page.locator('.chart-host').screenshot({ path: testInfo.outputPath('sl-band-clamped.png') });
  await release();
  // At the far edge the (projected) SL money label is the budget, never above it, and within one tick (0.06 USD) of it.
  await expect.poll(async () => slMoneyMagnitude(page)).toBeGreaterThan(6.25 - 0.06 - 1e-9);
  expect(await slMoneyMagnitude(page)).toBeLessThanOrEqual(6.25);
  expect(collected).toEqual({ pageErrors: [], consoleErrors: [] });
  await expect(page.getByLabel('Stop loss price')).toHaveValue(FAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampEdge).toBeNull();
  await expect(page.getByText('Risk is too low for the minimum order size')).toHaveCount(0);
});

test('dragging the SL toward the entry stops at the near edge', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.nearY - 40);
  await expect(page.getByLabel('Stop loss price')).toHaveValue(NEAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampEdge).toBe('near');
  await release();
});

test('holding Alt changes nothing: the SL drag is still clamped', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.farY + 50, true);
  await expect(page.getByLabel('Stop loss price')).toHaveValue(FAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampEdge).toBe('far');
  await release();
});

test('units mode has no band and no clamp', async ({ page }) => {
  await stageRiskOrder(page, 'Units');
  expect((await geometry(page)).slBand).toBeNull();
  const release = await dragSlHandle(page, (geo) => geo.slHandle!.y + 150);
  await expect
    .poll(async () => Number(await page.getByLabel('Stop loss price').inputValue()))
    .toBeLessThan(Number(FAR_EDGE));
  await release();
  expect((await geometry(page)).slClampHint).toBeNull();
});

test('clampStopLoss holds each side inside its band and ignores empty or missing bands', () => {
  const band = { nearPrice: 99.9, farPrice: 90, empty: false, emptyHint: 'e' };
  expect(clampStopLoss(80, 'buy', band)).toEqual({ price: 90, edge: 'far' });
  expect(clampStopLoss(99.95, 'buy', band)).toEqual({ price: 99.9, edge: 'near' });
  expect(clampStopLoss(95, 'buy', band)).toEqual({ price: 95, edge: null });
  const sell = { ...band, nearPrice: 100.1, farPrice: 110 };
  expect(clampStopLoss(120, 'sell', sell)).toEqual({ price: 110, edge: 'far' });
  expect(clampStopLoss(100, 'sell', sell)).toEqual({ price: 100.1, edge: 'near' });
  expect(clampStopLoss(80, 'buy', { ...band, empty: true })).toEqual({ price: 80, edge: null });
  expect(clampStopLoss(80, 'buy', undefined)).toEqual({ price: 80, edge: null });
});

// Buy limit at 1.0830 with 5% of 125 USD at risk: the allowed SL runs from 21 ticks (0.00021) to 104 ticks
// (0.00104) below the entry, so the band travels with the entry line.
const LIMIT = { entry: '1.0845', stopLoss: '1.0840', takeProfit: '1.0860' };
const NEAR_DISTANCE = 0.00021;
const FAR_DISTANCE = 0.00104;

const priceToY = (geo: BandGeometry, price: number) =>
  geo.chartRect!.y +
  ((geo.priceRange!.max - price) / (geo.priceRange!.max - geo.priceRange!.min)) * geo.chartRect!.height;
const stopLossInput = (page: Page) => page.getByLabel('Stop loss price');

/** Grabs the limit entry line and drags it to `price`; resolves with the release callback. */
async function dragEntryTo(page: Page, price: number, alt = false) {
  const geo = await geometry(page);
  const x = geo.chartRect!.x + geo.chartRect!.width * 0.45;
  await page.mouse.move(x, geo.entryLineY!);
  if (alt) {
    await page.keyboard.down('Alt');
  }
  await page.mouse.down();
  await page.mouse.move(x, priceToY(geo, price), { steps: 12 });
  return async () => {
    await page.mouse.up();
    if (alt) {
      await page.keyboard.up('Alt');
    }
  };
}
const entryValue = async (page: Page) => Number(await page.getByLabel('Order price').inputValue());

test('plain-dragging a limit entry pushes an SL the band leaves behind, keeps it there, and never moves the TP', async ({
  page,
}) => {
  await stageRiskOrder(page, 'Risk, % equity', { limit: LIMIT });
  await expect(stopLossInput(page)).toHaveValue('1.0840');
  // Still inside the band after a small move: untouched.
  let release = await dragEntryTo(page, 1.0848);
  expect(Math.abs((await entryValue(page)) - 1.0848)).toBeLessThan(0.0001);
  await release();
  await expect(stopLossInput(page)).toHaveValue('1.0840');
  // Far enough up that the Max SL edge passes the SL: it is pushed to follow the edge exactly.
  release = await dragEntryTo(page, 1.0855);
  const entry = await entryValue(page);
  await expect.poll(async () => Number(await stopLossInput(page).inputValue())).toBeCloseTo(entry - FAR_DISTANCE, 5);
  await release();
  const pushed = await stopLossInput(page).inputValue();
  await expect(page.getByLabel('Take profit price')).toHaveValue('1.0860');
  // Back toward the old entry while the pushed SL is still inside the band: it does not snap back.
  release = await dragEntryTo(page, 1.085);
  await release();
  await expect(stopLossInput(page)).toHaveValue(pushed);
  // Back past the point where the SL is closer than the Min SL edge: it is pushed to that edge instead.
  release = await dragEntryTo(page, 1.0845);
  const lowEntry = await entryValue(page);
  await expect
    .poll(async () => Number(await stopLossInput(page).inputValue()))
    .toBeCloseTo(lowEntry - NEAR_DISTANCE, 5);
  await release();
  await expect(page.getByLabel('Take profit price')).toHaveValue('1.0860');
});

test('holding Alt changes nothing: the SL is still pushed along the entry drag', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity', { limit: LIMIT });
  const release = await dragEntryTo(page, 1.0855, true);
  const entry = await entryValue(page);
  expect(entry).toBeGreaterThan(1.0852);
  await expect.poll(async () => Number(await stopLossInput(page).inputValue())).toBeCloseTo(entry - FAR_DISTANCE, 5);
  await release();
});
