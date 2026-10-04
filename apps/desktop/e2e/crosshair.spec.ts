import { test, expect, type Page } from '@playwright/test';
import { gotoWithStub, STUB_NOW } from './tauriStub';
import type { CrosshairReadout } from '../src/features/chart/engine/crosshairPrimitive';

/**
 * The Cross tool: the rail's arrow reveals the tool menu (Escape closes it and
 * only it), the Cross row arms a pointer crosshair, and that crosshair reports
 * the bar time and price under the pointer together with the two axis labels it
 * paints.
 *
 * Assertions run against the controller's DEV test hook
 * (`__chartTest.crosshair()`), which returns the resolved readout and the
 * geometry of both label boxes — no pixel sampling. The expected time label is
 * rebuilt here from `STUB_NOW` with the platform's own UTC date parts, so the
 * production formatter is checked against an independent construction.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_MS = 300_000;

/** The reference label format, rebuilt from raw UTC parts: `Wed 30 Sep '26  07:51`. */
function expectedLabel(seconds: number): string {
  const at = new Date(seconds * 1000);
  const [date, clock] = at.toISOString().split('T');
  const [year, month, day] = date.split('-');
  return `${WEEKDAYS[at.getUTCDay()]} ${Number(day)} ${MONTHS[Number(month) - 1]} '${year.slice(2)}  ${clock.slice(0, 5)}`;
}

async function crosshair(page: Page): Promise<CrosshairReadout | null> {
  return page.evaluate(() => window.__chartTest?.crosshair() ?? null);
}

async function chartBars(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest?.data().length ?? 0);
}

async function candleX(page: Page, timeMs: number): Promise<number> {
  return page.evaluate((time) => {
    // timeToX signals "no coordinate" with NaN, never with null.
    const x = window.__chartTest?.timeToX(time);
    if (x === undefined || Number.isNaN(x)) {
      throw new Error('Real candle has no rendered coordinate');
    }
    return x;
  }, timeMs);
}

async function chartGeometry(page: Page): Promise<{ paneWidth: number; paneHeight: number }> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  const axis = await page.evaluate(() => {
    const w = window as unknown as {
      __chartTest?: { priceScale(): { axisWidth: number; paneHeight: number } };
    };
    return w.__chartTest?.priceScale() ?? { axisWidth: 0, paneHeight: 0 };
  });
  return { paneWidth: host.width - axis.axisWidth, paneHeight: axis.paneHeight };
}

/** Arms the Cross tool the way the owner does: rail arrow → Cross row. */
async function armCrosshair(page: Page): Promise<void> {
  await openToolMenu(page);
  const menu = page.locator('.tool-flyout');
  await menu.getByRole('menuitemradio', { name: 'Crosshair pointer' }).click();
  await expect(pointerHeadIcon(page)).toHaveAttribute('data-icon', 'crosshair');
  await expect(menu).toHaveCount(0);
}

/** The pointer group's head button — it shows the group's armed tool. */
const pointerHead = (page: Page) => page.locator('.tool-rail button[aria-label="Pointer tools"]');
const pointerHeadIcon = (page: Page) => pointerHead(page).locator('.drawing-tool-icon');

/**
 * The arrow tab and the Cross icon both open the tool menu, so the pointer has
 * to be on the split button first — the tab is revealed on hover/focus
 * (TV-style) and is not clickable while it is hidden.
 */
async function openToolMenu(page: Page): Promise<void> {
  // Park off the rail first: Escape hides the chevron until the pointer comes
  // back, and hover() alone fires no fresh pointerenter while it is still there.
  await page.mouse.move(700, 700);
  await page.locator('.tool-rail-split').hover();
  await expect(page.locator('.tool-rail-arrow')).toBeVisible();
  await page.locator('.tool-rail-arrow').click();
  await expect(page.locator('.tool-flyout')).toBeVisible();
}

/** The group's chevron, parsed from its path: a positive apex offset points right. */
async function arrowApexOffset(page: Page): Promise<number> {
  const d = await page.locator('.tool-rail-arrow-glyph path').getAttribute('d');
  const points = (d ?? '')
    .replace(/[A-Za-z]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number);
  return points[2] - points[0];
}

test.describe('crosshair', () => {
  test('the rail arrow opens the tool menu, Escape closes only the menu, and Cross arms the tool', async ({ page }) => {
    const { pageErrors } = await gotoWithStub(page);
    const arrow = page.locator('.tool-rail-arrow');
    const head = pointerHead(page);
    const menu = page.locator('.tool-flyout');
    await expect(menu).toHaveCount(0);
    await expect(arrow).toHaveAttribute('aria-expanded', 'false');
    // The indicator points right, at the menu it opens.
    expect(await arrowApexOffset(page)).toBeGreaterThan(0);
    await openToolMenu(page);
    await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    // The arrow points back at the rail while the menu is open.
    expect(await arrowApexOffset(page)).toBeLessThan(0);
    // The group lists exactly the two pointer tools, and neither carries a star.
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu).not.toContainText('★');
    await expect(menu.getByRole('menuitemradio', { name: 'Fixed range volume profile' })).toHaveCount(0);
    // Focus lands on the checked row — the arrow pointer, while no tool is armed.
    await expect(menu.getByRole('menuitemradio', { name: 'Arrow pointer' })).toBeFocused();
    // Escape closes the menu, hands focus to the group's icon and takes the
    // pointer-only chevron away again.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(arrow).toHaveAttribute('aria-expanded', 'false');
    await expect(arrow).toBeHidden();
    await expect(head).toBeFocused();
    // The pointer is still on the tab it just clicked: leaving the rail and
    // hovering again (a fresh pointerenter) brings the chevron back.
    await page.mouse.move(700, 700);
    await expect(arrow).toBeHidden();
    await page.locator('.tool-rail-split').hover();
    await expect(arrow).toBeVisible();
    // The group's icon opens the same menu; Escape closes it the same way.
    await head.click();
    await expect(menu).toBeVisible();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(arrow).toBeHidden();
    await expect(head).toBeFocused();
    // Arming the crosshair pointer swaps the group head's icon to the crosshair.
    await armCrosshair(page);
    await expect(head).toHaveClass(/active/);
    // Reopening the menu now focuses the crosshair row, the checked one.
    await openToolMenu(page);
    await expect(menu.getByRole('menuitemradio', { name: 'Crosshair pointer' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // With the menu closed, Escape still cancels the armed tool (unchanged rule).
    await page.keyboard.press('Escape');
    await expect(head).toHaveClass(/active/);
    await expect(pointerHeadIcon(page)).toHaveAttribute('data-icon', 'cursor');
    expect(pageErrors).toEqual([]);
  });

  test('the crosshair reports the bar time and price under the pointer with both axis labels', async ({ page }) => {
    const { pageErrors } = await gotoWithStub(page);
    await expect.poll(async () => chartBars(page), { timeout: 10_000 }).toBe(10);
    await armCrosshair(page);
    const host = (await page.locator('.chart-host').boundingBox())!;
    const pane = await chartGeometry(page);
    // Aim at the oldest real candle — far enough from the right edge for the
    // time label to sit dead centre on the pointer — at 40% of the pane height.
    const timeMs = STUB_NOW - 9 * BAR_MS;
    const local = { x: await candleX(page, timeMs), y: Math.round(pane.paneHeight * 0.4) };
    await page.mouse.move(host.x + local.x, host.y + local.y);
    await expect.poll(async () => (await crosshair(page)) !== null, { timeout: 5_000 }).toBe(true);
    const state = (await crosshair(page))!;
    // The crosshair sits exactly under the pointer, in pane coordinates.
    expect(state.x).toBeCloseTo(local.x, 0);
    expect(state.y).toBeCloseTo(local.y, 0);
    // Time readout: the bar under the pointer, in the axis' own UTC frame.
    const seconds = timeMs / 1000;
    expect(state.timeSeconds).toBe(seconds);
    expect(state.timeLabel).toBe(expectedLabel(seconds));
    // Price readout: the series' own formatting of the price at that y.
    expect(state.priceLabel).toMatch(/^\d+\.\d+$/);
    expect(Number(state.priceLabel)).toBeCloseTo(state.price!, 4);
    // Price label: hugged against the pane's right edge, centred on the pointer.
    const price = state.priceLabelBox!;
    expect(price.x + price.width).toBeCloseTo(pane.paneWidth - 4, 0);
    expect(price.height).toBe(22);
    expect(price.y + price.height / 2).toBeCloseTo(state.y, 0);
    // Time label: centred on the pointer x, in the time axis' own canvas
    // (its y is measured from the top of that axis, not of the pane).
    const timeAxisHeight = host.height - pane.paneHeight;
    const time = state.timeLabelBox!;
    expect(time.x + time.width / 2).toBeCloseTo(state.x, 0);
    expect(time.x).toBeGreaterThanOrEqual(0);
    expect(time.x + time.width).toBeLessThanOrEqual(pane.paneWidth + 1);
    expect(time.y).toBeGreaterThanOrEqual(0);
    expect(time.y + time.height).toBeLessThanOrEqual(timeAxisHeight + 1);
    expect(time.y + time.height / 2).toBeCloseTo(timeAxisHeight / 2, 0);
    // Horizontal moves keep the price, vertical moves change it — the readout
    // tracks the pointer rather than the last resolved value.
    await page.mouse.move(host.x + local.x - 40, host.y + local.y);
    await expect.poll(async () => (await crosshair(page))?.price).toBe(state.price);
    await page.mouse.move(host.x + local.x - 40, host.y + local.y - 60);
    await expect.poll(async () => (await crosshair(page))?.price).not.toBe(state.price);
    // Near the pane's right edge the time label is pushed back inside the pane
    // instead of overflowing it.
    const last = { x: await candleX(page, STUB_NOW - BAR_MS), y: local.y };
    await page.mouse.move(host.x + last.x, host.y + last.y);
    await expect.poll(async () => (await crosshair(page))?.x).toBeCloseTo(last.x, 0);
    const edge = (await crosshair(page))!.timeLabelBox!;
    expect(edge.x + edge.width).toBeLessThanOrEqual(pane.paneWidth + 1);
    expect(edge.x + edge.width / 2).toBeCloseTo(Math.min(last.x, pane.paneWidth - edge.width / 2), 0);
    expect(pageErrors).toEqual([]);
  });

  test('the crosshair hides outside the pane, on pointer leave and when the tool is disarmed', async ({ page }) => {
    const { pageErrors } = await gotoWithStub(page);
    await expect.poll(async () => chartBars(page), { timeout: 10_000 }).toBe(10);
    const host = (await page.locator('.chart-host').boundingBox())!;
    const pane = await chartGeometry(page);
    const centre = { x: Math.round(pane.paneWidth / 2), y: Math.round(pane.paneHeight / 2) };
    // Cursor (no tool): hovering the pane must not draw a crosshair at all.
    await page.mouse.move(host.x + centre.x, host.y + centre.y);
    expect(await crosshair(page)).toBeNull();
    await armCrosshair(page);
    await page.mouse.move(host.x + centre.x, host.y + centre.y);
    await expect.poll(async () => (await crosshair(page)) !== null).toBe(true);
    // Over the price axis the crosshair has no time/price to report: it hides.
    await page.mouse.move(host.x + pane.paneWidth + 20, host.y + centre.y);
    await expect.poll(async () => await crosshair(page)).toBeNull();
    // Leaving the chart hides it too.
    await page.mouse.move(host.x + centre.x, host.y + centre.y);
    await expect.poll(async () => (await crosshair(page)) !== null).toBe(true);
    await page.mouse.move(host.x + centre.x, host.y - 40);
    await expect.poll(async () => await crosshair(page)).toBeNull();
    // Disarming the tool (the profile tool) hides a crosshair still under the pointer.
    await page.mouse.move(host.x + centre.x, host.y + centre.y);
    await expect.poll(async () => (await crosshair(page)) !== null).toBe(true);
    await page.locator('.tool-rail button[aria-label="Fixed range volume profile"]').click();
    await expect.poll(async () => await crosshair(page)).toBeNull();
    expect(pageErrors).toEqual([]);
  });
});
