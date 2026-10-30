import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

const TRADE_PANEL_LABEL = 'Trade panel';
const OBJECT_TREE_LABEL = 'Object tree';
const CHART_SECTION = '.chart-section';
const SIDE_DRAWER_STRIP = '.side-drawer-strip';
const TRADE_PANEL_DRAWER = 'aside.trade-panel';
const OBJECT_TREE_DRAWER = 'aside[aria-label="Object tree"]';

/* Wide enough for the dashboard to shrink the chart beside an open drawer instead
   of overlaying it, so the geometry assertions below hold. */
test.use({ viewport: { width: 1280, height: 800 } });

/** A strip button by its accessible name: exact, so the topbar's "Toggle …" never matches. */
function stripButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

/** The horizontal edges of `locator`; fails when the element has no layout box. */
async function horizontalEdges(locator: Locator): Promise<{ left: number; right: number }> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('The measured element has no layout box.');
  }
  return { left: box.x, right: box.x + box.width };
}

/** Gap between the chart card's right edge and `neighbour`'s left edge; negative while they overlap. */
async function chartGapTo(page: Page, neighbour: Locator): Promise<number> {
  const chart = await horizontalEdges(page.locator(CHART_SECTION));
  const other = await horizontalEdges(neighbour);
  return other.left - chart.right;
}

const DRAWER_TO_STRIP_GAP_PX = 8;
const CHART_TO_DRAWER_GAP_PX = 8;
const GAP_TOLERANCE_PX = 0.5;

/** Gap between `neighbour`'s right edge and the strip's left edge. */
async function gapToStrip(page: Page, neighbour: Locator): Promise<number> {
  const strip = await horizontalEdges(page.locator(SIDE_DRAWER_STRIP));
  const other = await horizontalEdges(neighbour);
  return strip.left - other.right;
}

function isWithinTolerance(actualGap: number, expectedGap: number): boolean {
  return Math.abs(actualGap - expectedGap) <= GAP_TOLERANCE_PX;
}

test('the strip offers both drawers and none is open initially', async ({ page }) => {
  const { pageErrors, consoleErrors } = await gotoWithStub(page);
  const tradePanelButton = stripButton(page, TRADE_PANEL_LABEL);
  const objectTreeButton = stripButton(page, OBJECT_TREE_LABEL);
  await expect(tradePanelButton).toBeVisible();
  await expect(objectTreeButton).toBeVisible();
  await expect(tradePanelButton).toHaveAttribute('aria-pressed', 'false');
  await expect(objectTreeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(TRADE_PANEL_DRAWER)).toBeHidden();
  await expect(page.locator(OBJECT_TREE_DRAWER)).toBeHidden();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('the object tree button opens and closes the object tree drawer', async ({ page }) => {
  await gotoWithStub(page);
  const objectTreeButton = stripButton(page, OBJECT_TREE_LABEL);
  const objectTreeDrawer = page.locator(OBJECT_TREE_DRAWER);
  await objectTreeButton.click();
  await expect(objectTreeDrawer).toBeVisible();
  await expect(objectTreeDrawer.getByRole('heading', { name: OBJECT_TREE_LABEL })).toBeVisible();
  await expect(objectTreeButton).toHaveAttribute('aria-pressed', 'true');
  await objectTreeButton.click();
  await expect(objectTreeDrawer).toBeHidden();
  await expect(objectTreeButton).toHaveAttribute('aria-pressed', 'false');
});

test('opening one drawer closes the other', async ({ page }) => {
  await gotoWithStub(page);
  const tradePanelButton = stripButton(page, TRADE_PANEL_LABEL);
  const objectTreeButton = stripButton(page, OBJECT_TREE_LABEL);
  const tradePanelDrawer = page.locator(TRADE_PANEL_DRAWER);
  const objectTreeDrawer = page.locator(OBJECT_TREE_DRAWER);
  const topbarButton = page.getByRole('button', { name: 'Toggle trade panel' });

  await tradePanelButton.click();
  await expect(tradePanelDrawer).toBeVisible();
  await objectTreeButton.click();
  await expect(objectTreeDrawer).toBeVisible();
  await expect(tradePanelDrawer).toBeHidden();
  await expect(topbarButton).toHaveAttribute('aria-expanded', 'false');

  await tradePanelButton.click();
  await expect(tradePanelDrawer).toBeVisible();
  await expect(objectTreeDrawer).toBeHidden();
  await expect(objectTreeButton).toHaveAttribute('aria-pressed', 'false');
});

test('the strip and topbar trade panel buttons stay in sync', async ({ page }) => {
  await gotoWithStub(page);
  const tradePanelButton = stripButton(page, TRADE_PANEL_LABEL);
  const topbarButton = page.getByRole('button', { name: 'Toggle trade panel' });

  await tradePanelButton.click();
  await expect(tradePanelButton).toHaveAttribute('aria-pressed', 'true');
  await expect(topbarButton).toHaveAttribute('aria-expanded', 'true');

  await topbarButton.click();
  await expect(tradePanelButton).toHaveAttribute('aria-pressed', 'false');
  await expect(topbarButton).toHaveAttribute('aria-expanded', 'false');
});

test('the chart clears the strip when closed and the open drawer when open', async ({ page }) => {
  await gotoWithStub(page);
  await expect.poll(() => chartGapTo(page, page.locator(SIDE_DRAWER_STRIP))).toBeGreaterThan(0);

  await stripButton(page, OBJECT_TREE_LABEL).click();
  const objectTreeDrawer = page.locator(OBJECT_TREE_DRAWER);
  await expect(objectTreeDrawer).toBeVisible();
  await expect.poll(() => chartGapTo(page, objectTreeDrawer)).toBeGreaterThan(0);
});

test('the open trade panel stands off the strip by the drawer gap', async ({ page }) => {
  await gotoWithStub(page);
  await stripButton(page, TRADE_PANEL_LABEL).click();
  const tradePanelDrawer = page.locator(TRADE_PANEL_DRAWER);
  await expect(tradePanelDrawer).toBeVisible();

  // The drawer slides in over 0.2s, so poll until the edges settle.
  const drawerSitsOffStrip = async () =>
    isWithinTolerance(await gapToStrip(page, tradePanelDrawer), DRAWER_TO_STRIP_GAP_PX);
  const chartSitsOffDrawer = async () =>
    isWithinTolerance(await chartGapTo(page, tradePanelDrawer), CHART_TO_DRAWER_GAP_PX);
  await expect.poll(drawerSitsOffStrip).toBe(true);
  await expect.poll(chartSitsOffDrawer).toBe(true);
});
