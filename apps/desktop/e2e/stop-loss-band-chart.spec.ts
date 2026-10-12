import { expect, test, type Page } from '@playwright/test';
import { brokerSymbolFixture, gotoWithStub } from './helpers/tauriStub';
import { fillExitPrice, openTradePanel } from './helpers/panel';
import { clampStopLoss } from '../src/features/chart/engine/stagedOrderGestures';

// Balance 125 USD x 5% = 6.25 USD of risk. With 0.6 USD per 0.00001 tick per lot
// the minimum 0.1 lot spends it all at 104 ticks (0.00104) from the 1.0850 ask.
// BUY market stop distance is measured from the 1.0846 bid: 21 ticks -> 1.08439.
const instrument = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', {
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  tickValueProfit: '0.6',
  tickValueLoss: '0.6',
  volumeMin: '0.1',
  volumeMax: '100',
  volumeStep: '0.1',
});
const FAR_EDGE = '1.08396';
const NEAR_EDGE = '1.08439';

interface BandGeometry {
  labels: Array<{ level: string; lineY: number }>;
  entryLineY: number | null;
  slHandle: { x: number; y: number; w: number; h: number } | null;
  slBand: { nearPrice: number; farPrice: number; empty: boolean } | null;
  slBandY: { nearY: number; farY: number } | null;
  slClampHint: string | null;
}
async function geometry(page: Page): Promise<BandGeometry> {
  return page.evaluate(() => {
    const w = window as unknown as { __stagedWidgetTest: { geometry(): unknown } };
    return w.__stagedWidgetTest.geometry() as BandGeometry;
  });
}
async function stageRiskOrder(page: Page, mode: 'Risk, % equity' | 'Units') {
  const collected = await gotoWithStub(page, {
    symbolInfo: instrument,
    responses: {
      get_account_snapshot: {
        accountLogin: '50123456',
        brokerServer: 'Broker-Demo',
        accountTradeMode: 0,
        accountTradeModeName: 'demo',
        currency: 'USD',
        currencyDigits: 2,
        balance: '125.00',
        equity: '125.00',
        margin: '0.00',
        freeMargin: '125.00',
        marginLevel: '0.00',
        leverage: 100,
        marginMode: 2,
        tradeAllowed: true,
        expertAllowed: true,
      },
    },
  });
  await openTradePanel(page);
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await page.locator('.ticket-menu-trigger').click();
  await page.getByRole('menuitemradio', { name: mode }).click();
  if (mode !== 'Units') {
    await page.getByLabel('Risk percent', { exact: true }).fill('5');
  }
  await fillExitPrice(page, 'Stop loss', '1.0840');
  // The unset SL handle floats beside the entry; wait until it has moved onto the typed 1.0840 line.
  await expect
    .poll(async () => {
      const geo = await geometry(page);
      return geo.slHandle !== null && geo.entryLineY !== null && geo.slHandle.y > geo.entryLineY + 40;
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

test('risk % mode shades the SL prices outside the allowed band', async ({ page }, testInfo) => {
  await stageRiskOrder(page, 'Risk, % equity');
  await expect.poll(async () => (await geometry(page)).slBand?.farPrice).toBeCloseTo(Number(FAR_EDGE), 8);
  const geo = await geometry(page);
  expect(geo.slBand?.nearPrice).toBeCloseTo(Number(NEAR_EDGE), 8);
  expect(geo.slBandY!.farY).toBeGreaterThan(geo.slBandY!.nearY);
  await page.locator('.chart-host').screenshot({ path: testInfo.outputPath('sl-band.png') });
});

test('dragging the SL past the far edge stops at the edge price and explains why', async ({ page }, testInfo) => {
  const collected = await stageRiskOrder(page, 'Risk, % equity');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.farY + 50);
  await expect(page.getByLabel('Stop loss price')).toHaveValue(FAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampHint).toBe('Max SL for 5% risk at 0.1 units');
  await page.locator('.chart-host').screenshot({ path: testInfo.outputPath('sl-band-clamped.png') });
  await release();
  expect(collected).toEqual({ pageErrors: [], consoleErrors: [] });
  await expect(page.getByLabel('Stop loss price')).toHaveValue(FAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampHint).toBeNull();
  await expect(page.getByText('Risk is too low for the minimum order size')).toHaveCount(0);
});

test('dragging the SL toward the entry stops at the near edge', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.nearY - 40);
  await expect(page.getByLabel('Stop loss price')).toHaveValue(NEAR_EDGE);
  await expect.poll(async () => (await geometry(page)).slClampHint).toBe('Min SL: broker stop distance');
  await release();
});

test('holding Alt while dragging disables the clamp', async ({ page }) => {
  await stageRiskOrder(page, 'Risk, % equity');
  const release = await dragSlHandle(page, (geo) => geo.slBandY!.farY + 50, true);
  await expect
    .poll(async () => Number(await page.getByLabel('Stop loss price').inputValue()))
    .toBeLessThan(Number(FAR_EDGE));
  expect((await geometry(page)).slClampHint).toBeNull();
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
  const band = { nearPrice: 99.9, farPrice: 90, empty: false, nearHint: 'n', farHint: 'f', emptyHint: 'e' };
  expect(clampStopLoss(80, 'buy', band)).toEqual({ price: 90, edge: 'far' });
  expect(clampStopLoss(99.95, 'buy', band)).toEqual({ price: 99.9, edge: 'near' });
  expect(clampStopLoss(95, 'buy', band)).toEqual({ price: 95, edge: null });
  const sell = { ...band, nearPrice: 100.1, farPrice: 110 };
  expect(clampStopLoss(120, 'sell', sell)).toEqual({ price: 110, edge: 'far' });
  expect(clampStopLoss(100, 'sell', sell)).toEqual({ price: 100.1, edge: 'near' });
  expect(clampStopLoss(80, 'buy', { ...band, empty: true })).toEqual({ price: 80, edge: null });
  expect(clampStopLoss(80, 'buy', undefined)).toEqual({ price: 80, edge: null });
});
