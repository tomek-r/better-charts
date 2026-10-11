import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, openPositionFixture, STUB_NOW, wasInvoked } from './helpers/tauriStub';

interface Chip {
  id: string;
  x: number;
  y: number;
}
interface ChipGeometry {
  posCloses: Chip[];
  posPartials: Chip[];
}

async function openChart(page: Page, position: Record<string, unknown> = {}, partialClose = true) {
  await gotoWithStub(page, {
    partialClose,
    responses: {
      get_portfolio_snapshot: {
        accountLogin: '50123456',
        capturedAtMs: STUB_NOW,
        positions: [openPositionFixture({ volume_min: '0.01', volume_step: '0.01', priceOpen: '1.0850', ...position })],
        orders: [],
      },
    },
  });
  await expect.poll(async () => (await chips(page)).posCloses.length).toBe(1);
}

async function chips(page: Page): Promise<ChipGeometry> {
  return page.evaluate(() => {
    const api = (window as unknown as { __stagedWidgetTest: { realTrading(): ChipGeometry } }).__stagedWidgetTest;
    return api.realTrading();
  });
}

async function chipAt(page: Page, kind: keyof ChipGeometry): Promise<Chip> {
  return (await chips(page))[kind][0];
}

async function openMenuFromCaret(page: Page) {
  const caret = await chipAt(page, 'posPartials');
  await page.mouse.click(caret.x, caret.y);
  return page.getByRole('menu', { name: 'Close part of position' });
}

async function closeVolume(page: Page) {
  await expect.poll(async () => (await wasInvoked(page, 'close_position')) !== undefined).toBe(true);
  return (await wasInvoked(page, 'close_position'))?.args.volume;
}

test.describe('chip ▾ visibility', () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['without the capability', {}, false],
    ['without broker limits', { volume_min: null, volume_step: null }, true],
    ['for a minimum-lot position', { volume: '0.01' }, true],
  ];
  for (const [name, position, capability] of cases) {
    test(`is not painted ${name}`, async ({ page }) => {
      await openChart(page, position, capability);
      expect((await chips(page)).posPartials).toHaveLength(0);
    });
  }

  test('is painted when partial close is available', async ({ page }) => {
    await openChart(page);
    expect((await chips(page)).posPartials).toHaveLength(1);
  });

  test('sits right after the ✕ without overlapping it', async ({ page }) => {
    await openChart(page);
    const [close, caret] = [await chipAt(page, 'posCloses'), await chipAt(page, 'posPartials')];
    expect(caret.y).toBe(close.y);
    expect(caret.x - close.x).toBe(22);
  });
});

test.describe('chip menu', () => {
  test('▾ opens the preset menu at the chip and a preset sends its volume', async ({ page }) => {
    await openChart(page, { volume: '0.10' });
    const caret = await chipAt(page, 'posPartials');
    const menu = await openMenuFromCaret(page);
    const box = (await menu.boundingBox())!;
    expect(Math.abs(box.x - (caret.x - 10))).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(caret.y);
    await expect(page.getByRole('menuitem')).toHaveText([
      'Close 25%0.02 units',
      'Close 50%0.05 units',
      'Close 75%0.07 units',
      'Custom volume…',
    ]);
    await page.getByRole('menuitem', { name: /Close 75%/ }).click();
    expect(await closeVolume(page)).toBe('0.07');
    await expect(menu).toHaveCount(0);
  });

  test('displays EA 8-decimal volumes without trailing zeros and sends a valid decimal', async ({ page }) => {
    await openChart(page, { volume: '0.10000000', volume_min: '0.01000000', volume_step: '0.01000000' });
    const menu = await openMenuFromCaret(page);
    await expect(menu.getByRole('menuitem', { name: /Close 50%/ })).toHaveText('Close 50%0.05 units');
    await menu.getByRole('menuitem', { name: 'Custom volume…' }).click();
    const form = page.getByRole('form', { name: 'Close part of EURUSD BUY' });
    await expect(form).toContainText('of 0.1 units');
    await expect(form.getByLabel('Volume to close')).toHaveValue('0.05');
    await expect(form.locator('.partial-bar-labels')).toHaveText('Close 0.05Keep 0.05');
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    const sent = await closeVolume(page);
    expect(sent).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(sent)).toBe(0.05);
  });

  test('right-clicking ✕ opens the same menu without closing', async ({ page }) => {
    await openChart(page);
    const close = await chipAt(page, 'posCloses');
    await page.mouse.click(close.x, close.y, { button: 'right' });
    await expect(page.getByRole('menu', { name: 'Close part of position' })).toBeVisible();
    expect(await wasInvoked(page, 'close_position')).toBeUndefined();
  });

  test('left-clicking ✕ still sends a full close', async ({ page }) => {
    await openChart(page);
    const close = await chipAt(page, 'posCloses');
    await page.mouse.click(close.x, close.y);
    expect(await closeVolume(page)).toBeNull();
  });

  test('Escape and an outside press dismiss the menu', async ({ page }) => {
    await openChart(page);
    const menu = await openMenuFromCaret(page);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await openMenuFromCaret(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    await page.mouse.click(host.x + host.width * 0.8, host.y + 40);
    await expect(menu).toHaveCount(0);
  });

  test('stays inside the chart frame', async ({ page }) => {
    await openChart(page);
    const menu = await openMenuFromCaret(page);
    const frame = (await page.locator('.chart-frame').boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
  });
});

test.describe('chip custom volume', () => {
  async function openCustomVolume(page: Page) {
    await openMenuFromCaret(page);
    await page.getByRole('menuitem', { name: 'Custom volume…' }).click();
    return page.getByRole('form', { name: 'Close part of EURUSD BUY' });
  }

  test('sends the typed volume', async ({ page }) => {
    await openChart(page);
    const form = await openCustomVolume(page);
    await form.getByLabel('Volume to close').fill('0.25');
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await closeVolume(page)).toBe('0.25');
    await expect(form).toHaveCount(0);
  });

  test('disables the chip ✕ while open and re-enables it after Cancel and Escape', async ({ page }) => {
    await openChart(page);
    const close = await chipAt(page, 'posCloses');
    const form = await openCustomVolume(page);
    await page.mouse.click(close.x, close.y);
    expect(await wasInvoked(page, 'close_position')).toBeUndefined();
    await expect(form).toBeVisible();

    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);

    await openCustomVolume(page);
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await page.mouse.click(close.x, close.y);
    expect(await closeVolume(page)).toBeNull();
  });
});
