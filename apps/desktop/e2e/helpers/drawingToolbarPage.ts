import { expect, type Page } from '@playwright/test';
import type { ChartDrawingRecord, ChartDrawingSelection } from '../../src/features/chart/engine/drawings/drawingRecord';
import { commitProfile, position } from './fixedRangeProfilePage';
import { chartDrawingScopeKey, stubChartDrawings } from './tauriStub';

/**
 * The drawing toolbar page steps the drawing-toolbar and drawing-settings specs share: the toolbar
 * locator, the selection and records the dev hook reports, and the records the stub's backend holds.
 */

/** The account the stub's bridge status, account snapshot and portfolio all report. */
export const TOOLBAR_ACCOUNT_KEY = '50123456@Broker-Demo';

/** The symbol every step here draws on. */
export const TOOLBAR_SYMBOL = 'EURUSD';

/** The one toolbar of the chart. */
export function drawingToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Drawing toolbar' });
}

/** The selection the chart holds, as the dev hook reports it. */
export async function selectedDrawing(page: Page): Promise<ChartDrawingSelection | null> {
  return page.evaluate(() => window.__chartTest?.selectedDrawing() ?? null);
}

/** Every drawing on the chart, in registry order. */
export async function chartDrawings(page: Page): Promise<ChartDrawingRecord[]> {
  return page.evaluate(() => window.__chartTest?.drawings() ?? []);
}

/** The records the stub's backend holds for the plot, in save order. */
export async function savedDrawings(page: Page): Promise<Array<Record<string, unknown>>> {
  const stored = await stubChartDrawings(page);
  const records = stored[chartDrawingScopeKey(TOOLBAR_ACCOUNT_KEY, TOOLBAR_SYMBOL)] ?? [];
  return records as Array<Record<string, unknown>>;
}

/** Clicks a pane point over bar slot `index` of the stub's ten-bar window, missing every drawing. */
export async function clickChartPoint(page: Page, index: number): Promise<void> {
  const spot = await position(page, index);
  await page.mouse.click(spot.x, spot.y);
}

/** Places one profile through real pointer events and waits for the toolbar it selects. */
export async function placeProfileWithToolbar(page: Page): Promise<void> {
  await commitProfile(page);
  await expect(drawingToolbar(page)).toBeVisible();
}
