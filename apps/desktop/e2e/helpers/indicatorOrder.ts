import { expect, type Page } from '@playwright/test';
import { readSavedIndicators, type SavedIndicator } from '../../src/features/chart/chartSettings/savedIndicators';
import { drawnIndicators } from './indicatorFrames';
import { indicatorRows } from './indicatorObjectTree';
import { storedIndicators } from './savedIndicators';

/** The names of the price-pane indicator rows of the object tree, top to bottom. */
export function indicatorRowNames(page: Page): Promise<Array<string | null>> {
  return indicatorRows(page)
    .locator('.object-tree-row-label')
    .evaluateAll((labels) => labels.map((label) => label.textContent));
}

/**
 * The saved indicators' instance ids, in the order the chart's settings document stores them, top first. The
 * order is read from the document the backend holds, so it reads the same before and after a reload, whatever
 * this page load has saved so far.
 */
export async function savedIndicatorOrder(page: Page): Promise<string[]> {
  const saved = readSavedIndicators(await storedIndicators(page)) ?? [];
  return saved.map((indicator: SavedIndicator) => indicator.instanceId);
}

/** The index one indicator's plots hold among its pane's series: the greater it is, the higher it paints. */
export async function seriesOrderOf(page: Page, instanceId: string): Promise<number | null> {
  const drawn = await drawnIndicators(page);
  return drawn.find((indicator) => indicator.id === instanceId)?.seriesOrder ?? null;
}

/** Whether the chart paints `top` over `under`: the saved order's first is the higher series order. */
export async function paintsOver(page: Page, top: string, under: string): Promise<boolean> {
  const [topOrder, underOrder] = [await seriesOrderOf(page, top), await seriesOrderOf(page, under)];
  return topOrder !== null && underOrder !== null && topOrder > underOrder;
}

/** Waits for the chart to save `top` ahead of `under` (the only two indicators) and to paint it over it. */
export async function expectPaintedOnTop(page: Page, top: string, under: string): Promise<void> {
  await expect.poll(() => savedIndicatorOrder(page)).toEqual([top, under]);
  await expect.poll(() => paintsOver(page, top, under)).toBe(true);
}
