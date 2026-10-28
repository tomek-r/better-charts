import { expect, test, type Page } from '@playwright/test';
import { brokerSymbolFixture, gotoWithStub, stubInvocations } from './helpers/tauriStub';
import { tradingPortfolio } from './helpers/tradingPortfolio';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { fillExitPrice, openTradePanel } from './helpers/panel';

/**
 * Pins how the chart host routes pointer, touch and key events to the trading gestures: aborting events
 * (pointercancel, lostpointercapture, touchcancel, a pointermove with no button, Escape) must never send an
 * execution command, and a release (pointerup, touchend) must send exactly one.
 */

interface RoutedGeometry {
  posCloses: Array<{ id: string; x: number; y: number; r: number }>;
  orderCancels: Array<{ id: string; x: number; y: number; r: number }>;
  slLines: Array<{ id: string; y: number }>;
}

async function geometry(page: Page): Promise<RoutedGeometry> {
  return page.evaluate(() => {
    const w = window as unknown as { __stagedWidgetTest: { realTrading(): RoutedGeometry } };
    return w.__stagedWidgetTest.realTrading();
  });
}
async function readyWithTradingLines(page: Page) {
  await gotoWithStub(page, {
    responses: {
      get_portfolio_snapshot: tradingPortfolio,
      get_execution_safety_status: {
        journalState: 'ready',
        commandCount: 0,
        dispatchEnabled: true,
        message: 'Stub execution gate',
      },
      get_execution_queue_status: { pending: 0, inFlight: null, dispatchEnabled: true },
    },
    symbolInfo: brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', { digits: 4, tickSize: '0.0001' }),
  });
  await expect.poll(async () => (await geometry(page)).slLines.length).toBe(1);
  await expect.poll(async () => (await geometry(page)).posCloses.length).toBe(1);
  await expect.poll(async () => (await geometry(page)).orderCancels.length).toBe(1);
}
const orderCommands = ['modify_order', 'close_position', 'cancel_order'];
async function sentOrderCommands(page: Page) {
  return (await stubInvocations(page)).filter((entry) => orderCommands.includes(entry.cmd)).map((entry) => entry.cmd);
}
async function expectNoOrderCommand(page: Page) {
  // Give any (wrong) asynchronous dispatch a chance to land before asserting its absence.
  await page.waitForTimeout(200);
  expect(await sentOrderCommands(page)).toEqual([]);
}
async function slLinePoint(page: Page) {
  const y = (await geometry(page)).slLines[0].y;
  const host = (await page.locator('.chart-host').boundingBox())!;
  return { x: host.x + host.width * 0.65, y };
}
/** Presses on the SL line and drags it down, leaving the button held. */
async function holdSlLineDrag(page: Page) {
  const { x, y } = await slLinePoint(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 24, { steps: 8 });
  return { x, y };
}
async function dispatchOnHost(page: Page, type: string, init: Record<string, unknown> = {}) {
  await page.locator('.chart-host').dispatchEvent(type, { pointerId: 1, ...init });
}
/** Dispatches a one-finger touch event on the chart host; end and cancel carry no active touches. */
async function dispatchTouch(
  page: Page,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  x: number,
  y: number,
) {
  await page.evaluate(
    ({ type: eventType, x: clientX, y: clientY }) => {
      const host = document.querySelector('.chart-host')!;
      const touch = new Touch({ identifier: 1, target: host, clientX, clientY });
      const active = eventType === 'touchend' || eventType === 'touchcancel' ? [] : [touch];
      host.dispatchEvent(
        new TouchEvent(eventType, {
          bubbles: true,
          cancelable: true,
          touches: active,
          targetTouches: active,
          changedTouches: [touch],
        }),
      );
    },
    { type, x, y },
  );
}
async function dragSlLineByTouch(page: Page) {
  const { x, y } = await slLinePoint(page);
  await dispatchTouch(page, 'touchstart', x, y);
  await dispatchTouch(page, 'touchmove', x, y + 12);
  await dispatchTouch(page, 'touchmove', x, y + 24);
  return { x, y };
}

test.describe('trading line drag', () => {
  test('pointerup after a drag sends exactly one modification', async ({ page }) => {
    await readyWithTradingLines(page);
    await holdSlLineDrag(page);
    await page.mouse.up();
    await expect.poll(async () => (await sentOrderCommands(page)).length).toBe(1);
    expect(await sentOrderCommands(page)).toEqual(['modify_order']);
  });

  for (const abort of ['pointercancel', 'lostpointercapture'] as const) {
    test(`${abort} during a drag sends no command and restores the line`, async ({ page }) => {
      await readyWithTradingLines(page);
      const before = (await geometry(page)).slLines[0].y;
      await holdSlLineDrag(page);
      await dispatchOnHost(page, abort);
      await page.mouse.up();
      await expectNoOrderCommand(page);
      await expect.poll(async () => (await geometry(page)).slLines[0].y).toBeCloseTo(before, 5);
    });
  }

  test('a pointermove with no button held ends the drag without a command', async ({ page }) => {
    await readyWithTradingLines(page);
    const { x, y } = await holdSlLineDrag(page);
    await dispatchOnHost(page, 'pointermove', { buttons: 0, clientX: x, clientY: y + 30 });
    await page.mouse.up();
    await expectNoOrderCommand(page);
  });

  test('touchend after a drag sends exactly one modification', async ({ page }) => {
    await readyWithTradingLines(page);
    const { x, y } = await dragSlLineByTouch(page);
    await dispatchTouch(page, 'touchend', x, y + 24);
    await expect.poll(async () => (await sentOrderCommands(page)).length).toBe(1);
    expect(await sentOrderCommands(page)).toEqual(['modify_order']);
  });

  test('touchcancel during a drag sends no command and restores the line', async ({ page }) => {
    await readyWithTradingLines(page);
    const before = (await geometry(page)).slLines[0].y;
    const { x, y } = await dragSlLineByTouch(page);
    await dispatchTouch(page, 'touchcancel', x, y + 24);
    await expectNoOrderCommand(page);
    await expect.poll(async () => (await geometry(page)).slLines[0].y).toBeCloseTo(before, 5);
  });

  test('Escape during a touch drag sends no command', async ({ page }) => {
    await readyWithTradingLines(page);
    const { x, y } = await dragSlLineByTouch(page);
    await page.locator('.chart-host').focus();
    await page.keyboard.press('Escape');
    await dispatchTouch(page, 'touchend', x, y + 24);
    await expectNoOrderCommand(page);
  });
});

for (const action of ['close', 'cancel'] as const) {
  const command = action === 'close' ? 'close_position' : 'cancel_order';
  const chipOf = async (page: Page) => (await geometry(page))[action === 'close' ? 'posCloses' : 'orderCancels'][0];

  test.describe(`${action} chip press`, () => {
    test('pointerup on a still press sends exactly one command', async ({ page }) => {
      await readyWithTradingLines(page);
      const chip = await chipOf(page);
      await page.mouse.move(chip.x, chip.y);
      await page.mouse.down();
      expect(await sentOrderCommands(page)).toEqual([]);
      await page.mouse.up();
      await expect.poll(async () => await sentOrderCommands(page)).toEqual([command]);
    });

    for (const abort of ['pointercancel', 'lostpointercapture'] as const) {
      test(`${abort} before release sends no command`, async ({ page }) => {
        await readyWithTradingLines(page);
        const chip = await chipOf(page);
        await page.mouse.move(chip.x, chip.y);
        await page.mouse.down();
        await dispatchOnHost(page, abort);
        await page.mouse.up();
        await expectNoOrderCommand(page);
      });
    }

    test('Escape before release sends no command', async ({ page }) => {
      await readyWithTradingLines(page);
      const chip = await chipOf(page);
      await page.mouse.move(chip.x, chip.y);
      await page.mouse.down();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expectNoOrderCommand(page);
    });

    test('a press dragged off the chip is abandoned', async ({ page }) => {
      await readyWithTradingLines(page);
      const chip = await chipOf(page);
      await page.mouse.move(chip.x, chip.y);
      await page.mouse.down();
      await page.mouse.move(chip.x - 40, chip.y - 40, { steps: 6 });
      await page.mouse.up();
      await expectNoOrderCommand(page);
    });

    test('touchend on a still press sends exactly one command', async ({ page }) => {
      await readyWithTradingLines(page);
      const chip = await chipOf(page);
      await dispatchTouch(page, 'touchstart', chip.x, chip.y);
      await dispatchTouch(page, 'touchend', chip.x, chip.y);
      await expect.poll(async () => await sentOrderCommands(page)).toEqual([command]);
    });

    test('touchcancel before release sends no command', async ({ page }) => {
      await readyWithTradingLines(page);
      const chip = await chipOf(page);
      await dispatchTouch(page, 'touchstart', chip.x, chip.y);
      await dispatchTouch(page, 'touchcancel', chip.x, chip.y);
      await expectNoOrderCommand(page);
    });
  });
}

test.describe('staged stop-loss handle drag', () => {
  async function stageUnitsOrder(page: Page) {
    await gotoRiskBandStub(page);
    await openTradePanel(page);
    await page.locator('section.order-ticket .ticket-quote-side.buy').click();
    await page.locator('.ticket-menu-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Units' }).click();
    await fillExitPrice(page, 'Stop loss', '1.0840');
  }
  async function handleCentre(page: Page) {
    return page.evaluate(() => {
      const api = (
        window as unknown as {
          __stagedWidgetTest: { geometry(): { slHandle: { x: number; y: number; w: number; h: number } | null } };
        }
      ).__stagedWidgetTest;
      const handle = api.geometry().slHandle;
      return handle ? { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 } : null;
    });
  }

  test('pointercancel stops the drag: later pointer moves no longer move the handle', async ({ page }) => {
    await stageUnitsOrder(page);
    // The handle floats beside the entry until the typed stop loss moves it onto its line, and the price
    // scale refits afterwards: wait until the picture stops moving before grabbing it.
    let previous: number | undefined;
    await expect
      .poll(async () => {
        const current = (await handleCentre(page))?.y;
        const settled = current !== undefined && current === previous;
        previous = current;
        await page.waitForTimeout(150);
        return settled;
      })
      .toBe(true);
    const start = (await handleCentre(page))!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 30, { steps: 6 });
    await expect.poll(async () => (await handleCentre(page))!.y).toBeGreaterThan(start.y + 10);
    // Let the repaint of the last drag move settle so the cancelled position is a stable reference.
    await page.waitForTimeout(300);
    await dispatchOnHost(page, 'pointercancel');
    const afterCancel = (await handleCentre(page))!;
    await page.mouse.move(start.x, start.y + 80, { steps: 6 });
    await page.waitForTimeout(200);
    expect((await handleCentre(page))!.y).toBeCloseTo(afterCancel.y, 5);
    await page.mouse.up();
    expect(await sentOrderCommands(page)).toEqual([]);
  });
});
