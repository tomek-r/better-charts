import { expect, test, type Page } from '@playwright/test';
import { brokerSymbolFixture, gotoWithStub, pushEvent, STUB_NOW, stubInvocations } from './helpers/tauriStub';
import type { PortfolioSnapshot } from '../src/shared/bridge/types';
import { observeFillText } from './helpers/canvasText';
import { fillExitPrice, openTradePanel } from './helpers/panel';

interface TradingGeometry {
  labels: Array<{
    source: string;
    id: string;
    level: string;
    x: number;
    y: number;
    w: number;
    h: number;
    lineY: number;
  }>;
  posCloses: Array<{ id: string; x: number; y: number; r: number }>;
  orderCancels: Array<{ id: string; x: number; y: number; r: number }>;
  slLines: Array<{ id: string; y: number }>;
  tpLines: Array<{ id: string; y: number }>;
  orderLines: Array<{ id: string; y: number }>;
}
const portfolio: PortfolioSnapshot = {
  accountLogin: '50123456',
  capturedAtMs: STUB_NOW,
  positions: [
    {
      ticket: '1001',
      positionId: '885001',
      symbol: 'EURUSD',
      timeMs: STUB_NOW,
      magic: '0',
      side: 'buy',
      volume: '0.10',
      priceOpen: '1.0850',
      priceCurrent: '1.0852',
      profit: '1.20',
      swap: '0.00',
      stopLoss: '1.0840',
      takeProfit: '1.0860',
    },
  ],
  orders: [
    {
      orderId: '990001',
      symbol: 'EURUSD',
      timeSetupMs: STUB_NOW,
      magic: '0',
      orderType: 'sell_limit',
      state: 'placed',
      volumeInitial: '0.20',
      volumeCurrent: '0.20',
      priceOpen: '1.0855',
      priceCurrent: '1.0855',
      stopLoss: null,
      takeProfit: null,
    },
  ],
};
const instrument = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', {
  digits: 4,
  tickSize: '0.0001',
  pointSize: '0.0001',
  tickValueProfit: '10.0000',
  tickValueLoss: '10.0000',
});
async function geometry(page: Page): Promise<TradingGeometry> {
  return page.evaluate(() => {
    const w = window as unknown as { __stagedWidgetTest: { realTrading(): TradingGeometry } };
    return w.__stagedWidgetTest.realTrading();
  });
}
async function ready(
  page: Page,
  dispatchEnabled = true,
  orderOverrides: Partial<(typeof portfolio.orders)[number]> = {},
) {
  const collected = await gotoWithStub(page, {
    responses: {
      get_portfolio_snapshot: {
        ...portfolio,
        orders: portfolio.orders.map((order) => ({ ...order, ...orderOverrides })),
      },
      get_execution_safety_status: {
        journalState: 'ready',
        commandCount: 0,
        dispatchEnabled,
        message: 'Stub execution gate',
      },
      get_execution_queue_status: { pending: 0, inFlight: null, dispatchEnabled },
    },
  });
  await expect.poll(async () => (await geometry(page)).slLines.length).toBe(orderOverrides.stopLoss ? 2 : 1);
  await expect.poll(async () => (await geometry(page)).orderLines.length).toBe(1);
  return collected;
}
async function invocations(page: Page, command: string) {
  return (await stubInvocations(page)).filter((entry) => entry.cmd === command);
}
async function drag(page: Page, line: 'slLines' | 'tpLines' | 'orderLines', release = true, shift = false) {
  const y = (await geometry(page))[line][0].y;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const x = host.x + host.width * 0.65;
  await page.mouse.move(x, y);
  if (shift) {
    await page.keyboard.down('Shift');
  }
  await page.mouse.down();
  await page.mouse.move(x, y + 24, { steps: 8 });
  if (release) {
    await page.mouse.up();
  }
  if (shift) {
    await page.keyboard.up('Shift');
  }
}

// Observe the text painted on the actual canvas without exposing chart objects.
async function recordCanvasText(page: Page) {
  await observeFillText(page, () => {
    const texts = new Set<string>();
    const prefixes = new WeakMap<CanvasRenderingContext2D, string>();
    const w = window as unknown as { __paintedTradingText: Set<string> };
    w.__paintedTradingText = texts;
    return (context, text) => {
      texts.add(text);
      if (text.endsWith('P&L ')) {
        prefixes.set(context, text);
      } else if (prefixes.has(context)) {
        texts.add(prefixes.get(context) + text);
        prefixes.delete(context);
      }
    };
  });
}
async function paintedText(page: Page) {
  return page.evaluate(() =>
    [...(window as unknown as { __paintedTradingText: Set<string> }).__paintedTradingText].join('\n'),
  );
}
async function clearPaintedText(page: Page) {
  await page.evaluate(() => (window as unknown as { __paintedTradingText: Set<string> }).__paintedTradingText.clear());
}

test('live position paints broker P&L before symbol metadata is available', async ({ page }) => {
  await recordCanvasText(page);
  await ready(page);
  await expect.poll(() => paintedText(page)).toContain('P&L +1.20 USD');
  // RR is derived from the entry/SL/TP prices, so a live position shows it even
  // before symbol metadata (contract size / currency) arrives.
  await expect.poll(() => paintedText(page)).toContain('RR 1.00');
  expect(await paintedText(page)).not.toContain('SL -');
});

test('live P&L column grows to the widest observed amount and never shrinks', async ({ page }) => {
  await recordCanvasText(page);
  await observeFillText(page, () => {
    const w = window as unknown as {
      __positionSuffixX: number;
      __positionAmountRightX: number;
      __positionAmountStartX: number;
      __positionAmountWidth: number;
    };
    return (context, text, x) => {
      if (text.endsWith('P&L ')) {
        w.__positionAmountStartX = x + context.measureText(text).width;
      }
      if (context.textAlign === 'right' && /^[+-]/.test(text)) {
        w.__positionAmountRightX = x;
        w.__positionAmountWidth = context.measureText(text).width;
      }
      if (text.includes(' units')) {
        w.__positionSuffixX = x + context.measureText(text.slice(0, text.indexOf(' · '))).width;
      }
    };
  });
  await ready(page);
  await expect.poll(() => paintedText(page)).toContain('P&L +1.20 USD');
  const layout = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __positionSuffixX: number;
        __positionAmountRightX: number;
        __positionAmountStartX: number;
        __positionAmountWidth: number;
      };
      return {
        start: w.__positionAmountStartX,
        width: w.__positionAmountWidth,
        right: w.__positionAmountRightX,
        suffix: w.__positionSuffixX,
      };
    });
  const initial = await layout();
  let widest = initial.width;
  expect(initial.suffix).toBe(initial.start + widest);
  for (const profit of ['-15.60', '9999.99', '0.00', '1.20']) {
    await clearPaintedText(page);
    await pushEvent(page, 'portfolio-snapshot', {
      ...portfolio,
      positions: portfolio.positions.map((position) => ({ ...position, profit })),
    });
    await expect
      .poll(() => paintedText(page))
      .toContain(
        `P&L ${Number(profit) < 0 ? '-' : '+'}${Math.abs(Number(profit)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
      );
    const current = await layout();
    widest = Math.max(widest, current.width);
    expect(current.start).toBe(initial.start);
    expect(current.suffix).toBe(initial.start + widest);
    expect(current.right).toBe(current.suffix);
  }
});

test('bootstrap requests history once and restores live SL/TP amounts from symbol metadata', async ({ page }) => {
  await recordCanvasText(page);
  await gotoWithStub(page, { responses: { get_portfolio_snapshot: portfolio }, symbolInfo: instrument });
  await expect.poll(() => paintedText(page)).toContain('P&L +1.20 USD');
  await expect.poll(() => paintedText(page)).toContain('SL -10.00 USD');
  await expect.poll(() => paintedText(page)).toContain('TP +10.00 USD');
  expect((await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history')).toHaveLength(1);
});

test('placing a manual order retains SL and TP account amounts on the live position', async ({ page }) => {
  await recordCanvasText(page);
  await gotoWithStub(page, {
    symbolInfo: {
      ...instrument,
      tickSize: '0.00001',
      tickValueProfit: '1',
      tickValueLoss: '1',
      tradeMode: 4,
      orderMode: 127,
      fillingMode: 1,
      expirationMode: 15,
      tradeExecution: 2,
    },
  });
  await openTradePanel(page);
  await page.locator('.ticket-quote-side.buy').click();
  await fillExitPrice(page, 'Stop loss', '1.0840');
  await fillExitPrice(page, 'Take profit', '1.0860');
  await expect.poll(() => paintedText(page)).toContain('SL -100.00 USD');
  await expect.poll(() => paintedText(page)).toContain('TP +100.00 USD');
  await page.getByRole('button', { name: 'Start creating order', exact: true }).click();
  await page.getByRole('button', { name: 'Send order', exact: true }).click();
  await expect.poll(async () => (await invocations(page, 'submit_order')).length).toBe(1);
  await clearPaintedText(page);
  await pushEvent(page, 'portfolio-snapshot', {
    ...portfolio,
    positions: [{ ...portfolio.positions[0], volume: '1' }],
    orders: [],
  });
  await expect.poll(async () => (await geometry(page)).posCloses.length).toBe(1);
  await expect.poll(() => paintedText(page)).toContain('SL -100.00 USD');
  await expect.poll(() => paintedText(page)).toContain('TP +100.00 USD');
});

test('late contract and currency updates repaint live P&L and SL/TP amounts', async ({ page }) => {
  await recordCanvasText(page);
  await ready(page);
  await pushEvent(page, 'symbol-info', instrument);
  await expect.poll(() => paintedText(page)).toContain('SL -10.00 USD');
  await expect.poll(() => paintedText(page)).toContain('TP +10.00 USD');
  await clearPaintedText(page);
  await pushEvent(page, 'symbol-info', {
    ...instrument,
    contractSize: '200000',
    tickValueProfit: '20',
    tickValueLoss: '20',
  });
  await expect.poll(() => paintedText(page)).toContain('SL -20.00 USD');
  await expect.poll(() => paintedText(page)).toContain('TP +20.00 USD');
  await clearPaintedText(page);
  await pushEvent(page, 'account-snapshot', {
    accountLogin: portfolio.accountLogin,
    brokerServer: 'Broker-Demo',
    currency: 'EUR',
    balance: '10000.00',
    equity: '10001.20',
    margin: '100.00',
    freeMargin: '9901.20',
    marginLevel: '10001.20',
    leverage: 100,
    marginMode: 0,
    tradeAllowed: true,
    expertAllowed: true,
  });
  await expect.poll(() => paintedText(page)).toContain('P&L +1.20 EUR');
  await clearPaintedText(page);
  await pushEvent(page, 'symbol-info', {
    ...instrument,
    tickValueCurrency: 'EUR',
    tickValueProfit: '18',
    tickValueLoss: '19',
  });
  await expect.poll(() => paintedText(page)).toContain('SL -19.00 EUR');
  await expect.poll(() => paintedText(page)).toContain('TP +18.00 EUR');
});

for (const level of ['slLines', 'tpLines'] as const) {
  test(`position ${level} real drag dispatches exactly one modification after release`, async ({ page }) => {
    const collected = await ready(page);
    await drag(page, level, false);
    expect(await invocations(page, 'modify_order')).toHaveLength(0);
    await page.mouse.up();
    await expect.poll(async () => (await invocations(page, 'modify_order')).length).toBe(1);
    const request = (await invocations(page, 'modify_order'))[0];
    expect(request.args).toMatchObject({
      targetKind: 'position',
      targetId: '885001',
      accountLogin: '50123456',
      brokerServer: 'Broker-Demo',
      price: null,
    });
    expect(request.args[level === 'slLines' ? 'takeProfit' : 'stopLoss']).toBeNull();
    expect(Number(request.args[level === 'slLines' ? 'stopLoss' : 'takeProfit'])).toBeGreaterThan(1);
    await page.locator('.chart-host').dispatchEvent('lostpointercapture', { pointerId: 1 });
    expect(await invocations(page, 'modify_order')).toHaveLength(1);
    expect(collected.pageErrors).toEqual([]);
    expect(collected.consoleErrors).toEqual([]);
  });
}

test('live SL drag updates the entry RR before release, like the staged tag', async ({ page }) => {
  await recordCanvasText(page);
  await ready(page);
  await expect.poll(() => paintedText(page)).toContain('RR 1.00');
  const y = (await geometry(page)).slLines[0].y;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const x = host.x + host.width * 0.65;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Push SL away from the entry (downward for a long): risk grows, so the
  // ratio must move off 1.00 while the drag is still in flight.
  await page.mouse.move(x, y + 24, { steps: 8 });
  await expect.poll(() => paintedText(page)).toMatch(/RR (?!1\.00)\d/);
  await page.mouse.up();
});

test('submitted limit order retains RR and updates it during an exit drag', async ({ page }) => {
  await recordCanvasText(page);
  await ready(page, true, { stopLoss: '1.0860', takeProfit: '1.0850' });
  await expect.poll(() => paintedText(page)).toMatch(/Limit.*RR 1\.00/);
  await clearPaintedText(page);
  const orderSl = (await geometry(page)).slLines.find((line) => line.id === 'order:990001')!;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const x = host.x + host.width * 0.65;
  await page.mouse.move(x, orderSl.y);
  await page.mouse.down();
  await page.mouse.move(x, orderSl.y - 24, { steps: 8 });
  await expect.poll(() => paintedText(page)).toMatch(/Limit.*RR (?!1\.00)\d/);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await invocations(page, 'modify_order')).toHaveLength(0);
});

test('Escape cancels a trading drag and restores the line without dispatch', async ({ page }) => {
  await ready(page);
  const before = (await geometry(page)).slLines[0].y;
  await drag(page, 'slLines', false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await invocations(page, 'modify_order')).toHaveLength(0);
  await expect.poll(async () => (await geometry(page)).slLines[0].y).toBeCloseTo(before, 5);
});

for (const orderType of ['sell_limit', 'sell_stop_limit'] as const) {
  test(`${orderType} plain price drag updates MT5 and leaves exits unchanged`, async ({ page }) => {
    await ready(page, true, { orderType, stopLoss: '1.0857', takeProfit: '1.0853' });
    await drag(page, 'orderLines');
    await expect.poll(async () => (await invocations(page, 'modify_order')).length).toBe(1);
    const request = (await invocations(page, 'modify_order'))[0];
    expect(request.args).toMatchObject({
      targetKind: 'pending_order',
      targetId: '990001',
      accountLogin: '50123456',
      brokerServer: 'Broker-Demo',
      stopLoss: null,
      takeProfit: null,
    });
    expect(Number(request.args.price)).not.toBe(1.0855);
  });

  test(`${orderType} Shift-drag moves entry and exits, then plain drag preserves the exits`, async ({ page }) => {
    await ready(page, true, { orderType, stopLoss: '1.0857', takeProfit: '1.0853' });
    await expect.poll(async () => (await geometry(page)).tpLines.length).toBe(2);
    const before = await geometry(page);
    const orderY = (rows: TradingGeometry['orderLines']) => rows.find((row) => row.id === '990001')!.y;
    const exitY = (rows: TradingGeometry['slLines'] | TradingGeometry['tpLines']) =>
      rows.find((row) => row.id === 'order:990001')!.y;

    await drag(page, 'orderLines', true, true);
    await expect.poll(async () => (await invocations(page, 'modify_order')).length).toBe(1);
    const first = (await invocations(page, 'modify_order'))[0];
    expect(first.args).toMatchObject({ targetKind: 'pending_order', targetId: '990001' });
    const firstPrice = Number(first.args.price);
    const delta = firstPrice - 1.0855;
    expect(Number(first.args.stopLoss)).toBeCloseTo(1.0857 + delta, 5);
    expect(Number(first.args.takeProfit)).toBeCloseTo(1.0853 + delta, 5);

    const afterShift = await geometry(page);
    const entryMove = orderY(afterShift.orderLines) - orderY(before.orderLines);
    expect(exitY(afterShift.slLines) - exitY(before.slLines)).toBeCloseTo(entryMove, 2);
    expect(exitY(afterShift.tpLines) - exitY(before.tpLines)).toBeCloseTo(entryMove, 2);

    await drag(page, 'orderLines');
    await expect.poll(async () => (await invocations(page, 'modify_order')).length).toBe(2);
    const second = (await invocations(page, 'modify_order'))[1];
    expect(Number(second.args.stopLoss)).toBe(Number(first.args.stopLoss));
    expect(Number(second.args.takeProfit)).toBe(Number(first.args.takeProfit));
    const afterPlain = await geometry(page);
    expect(exitY(afterPlain.slLines)).toBeCloseTo(exitY(afterShift.slLines), 2);
    expect(exitY(afterPlain.tpLines)).toBeCloseTo(exitY(afterShift.tpLines), 2);
  });
}

for (const action of ['close', 'cancel'] as const) {
  test(`painted ${action} chip dispatches once through the existing execution handler`, async ({ page }) => {
    await ready(page);
    const chip = (await geometry(page))[action === 'close' ? 'posCloses' : 'orderCancels'][0];
    await page.mouse.click(chip.x, chip.y);
    const command = action === 'close' ? 'close_position' : 'cancel_order';
    await expect.poll(async () => (await invocations(page, command)).length).toBe(1);
    await page.locator('.chart-host').dispatchEvent('lostpointercapture', { pointerId: 1 });
    expect(await invocations(page, command)).toHaveLength(1);
  });
}

test('locked execution gate prevents trading-line dispatch after a completed drag', async ({ page }) => {
  await ready(page, false);
  await drag(page, 'slLines');
  expect(await invocations(page, 'modify_order')).toHaveLength(0);
  await drag(page, 'orderLines');
  expect(await invocations(page, 'modify_order')).toHaveLength(0);
});

/** Moves the position's SL next to its entry so the SL label has to be displaced from its line. */
async function readyWithCrowdedSl(page: Page) {
  const collected = await ready(page);
  await pushEvent(page, 'portfolio-snapshot', {
    ...portfolio,
    orders: [],
    positions: portfolio.positions.map((pos) => ({ ...pos, stopLoss: '1.08501', takeProfit: null })),
  });
  await expect.poll(async () => (await geometry(page)).orderLines.length).toBe(0);
  const before = await geometry(page);
  return { collected, before };
}

test('overlapping P&L and SL stay separated while crossing to the position close button', async ({ page }) => {
  const { collected, before } = await readyWithCrowdedSl(page);
  const entry = before.labels.find((row) => row.id === '885001' && row.level === 'entry')!;
  const sl = before.labels.find((row) => row.id === '885001' && row.level === 'sl')!;
  expect(Math.abs(entry.lineY - sl.lineY)).toBeLessThan(20);
  expect(Math.abs(entry.y - sl.y)).toBeGreaterThanOrEqual(32);
  const close = before.posCloses[0];
  await page.mouse.move(entry.x + entry.w - 5, entry.y + entry.h / 2);
  await page.mouse.move(close.x, close.y, { steps: 12 });
  expect((await geometry(page)).labels).toEqual(before.labels);
  await page.screenshot({ path: test.info().outputPath('spaced-trading-labels.png') });
  await page.mouse.down();
  expect(await invocations(page, 'close_position')).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(async () => (await invocations(page, 'close_position')).length).toBe(1);
  expect(await invocations(page, 'modify_order')).toHaveLength(0);
  expect(collected.pageErrors).toEqual([]);
  expect(collected.consoleErrors).toEqual([]);
});

test('dragging a displaced SL moves from its actual price instead of jumping to the label', async ({ page }) => {
  const { before } = await readyWithCrowdedSl(page);
  const sl = before.labels.find((row) => row.id === '885001' && row.level === 'sl')!;
  expect(Math.abs(sl.y + sl.h / 2 - sl.lineY)).toBeGreaterThan(1);
  const expected = await page.evaluate((y) => {
    const w = window as unknown as {
      __stagedWidgetTest: {
        geometry(): { priceRange: { min: number; max: number }; chartRect: { y: number; height: number } };
      };
    };
    const { priceRange, chartRect } = w.__stagedWidgetTest.geometry();
    return priceRange.max - ((y - chartRect.y) / chartRect.height) * (priceRange.max - priceRange.min);
  }, sl.lineY + 6);
  await page.mouse.move(sl.x + sl.w - 5, sl.y + sl.h / 2);
  await page.mouse.down();
  await page.mouse.move(sl.x + sl.w - 5, sl.y + sl.h / 2 + 6, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await invocations(page, 'modify_order')).length).toBe(1);
  const call = (await invocations(page, 'modify_order'))[0];
  expect(Number((call.args as { stopLoss: string }).stopLoss)).toBeCloseTo(expected, 5);
  expect(await invocations(page, 'close_position')).toHaveLength(0);
});
