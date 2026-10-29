import { expect, test, type Page } from '@playwright/test';
import { holdIdleCallbacks } from './helpers/tauriStub';
import { loadViewportWindow, waitForPaint } from './helpers/viewportHarness';

interface VisibleRange {
  from: number;
  to: number;
}

const PAN_AWAY_BARS = 40;
const ZOOM_IN_BARS = 30;
const ALLOWED_RANGE_DRIFT_BARS = 0.5;

/** The binding differs by platform: Option+R on macOS, Ctrl+R elsewhere (the stub's default platform is Linux). */
const SHORTCUTS = [
  { platform: 'macos', label: '⌥R', keys: 'Alt+R' },
  { platform: 'linux', label: 'Ctrl+R', keys: 'Control+R' },
] as const;

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

function visibleRange(page: Page): Promise<VisibleRange> {
  return page.evaluate(() => window.__chartTest!.visibleRange()!);
}

/** Pans the view away from the latest bar and zooms in, like the user does; returns the view as loaded. */
async function panAndZoom(page: Page): Promise<VisibleRange> {
  await waitForPaint(page);
  const loaded = await visibleRange(page);
  await page.evaluate(
    ({ pan, zoom }) => {
      const chart = window.__chartTest!;
      const range = chart.visibleRange()!;
      chart.scrollToRange({ from: range.from - pan, to: range.to - pan - zoom });
    },
    { pan: PAN_AWAY_BARS, zoom: ZOOM_IN_BARS },
  );
  await waitForPaint(page);
  const moved = await visibleRange(page);
  expect(moved.to).toBeLessThan(loaded.to - PAN_AWAY_BARS / 2);
  expect(moved.to - moved.from).toBeLessThan(loaded.to - loaded.from - ZOOM_IN_BARS / 2);
  return loaded;
}

async function expectViewRestored(page: Page, loaded: VisibleRange): Promise<void> {
  await expect
    .poll(async () => {
      const current = await visibleRange(page);
      return Math.abs(current.from - loaded.from) + Math.abs(current.to - loaded.to);
    })
    .toBeLessThan(ALLOWED_RANGE_DRIFT_BARS);
}

async function openChartMenu(page: Page) {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.click(host.x + host.width / 2, host.y + host.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Chart', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

test('right-click opens the chart menu and its item restores the loaded view', async ({ page }) => {
  await loadViewportWindow(page);
  const loaded = await panAndZoom(page);

  const menu = await openChartMenu(page);
  await menu.getByRole('menuitem', { name: /Reset chart view/ }).click();

  await expectViewRestored(page, loaded);
  await expect(menu).toHaveCount(0);
});

test('Escape closes the chart menu without resetting the view', async ({ page }) => {
  await loadViewportWindow(page);
  await panAndZoom(page);
  const moved = await visibleRange(page);

  const menu = await openChartMenu(page);
  await page.keyboard.press('Escape');

  await expect(menu).toHaveCount(0);
  expect(await visibleRange(page)).toEqual(moved);
});

for (const { platform, label, keys } of SHORTCUTS) {
  test.describe(`on ${platform}`, () => {
    test(`the menu item shows ${label}`, async ({ page }) => {
      await loadViewportWindow(page, { stub: { platform } });
      const menu = await openChartMenu(page);
      await expect(menu.getByRole('menuitem')).toContainText(label);
    });

    test(`${keys} restores the loaded view without a menu`, async ({ page }) => {
      await loadViewportWindow(page, { stub: { platform } });
      const loaded = await panAndZoom(page);
      await page.keyboard.press(keys);
      await expectViewRestored(page, loaded);
    });
  });
}

test('the shortcut leaves the view alone while a text field has focus', async ({ page }) => {
  await loadViewportWindow(page);
  await panAndZoom(page);
  const moved = await visibleRange(page);
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch field');
    document.body.append(field);
    field.focus();
  });

  await page.keyboard.press('Control+R');
  await waitForPaint(page);

  expect(await visibleRange(page)).toEqual(moved);
});
