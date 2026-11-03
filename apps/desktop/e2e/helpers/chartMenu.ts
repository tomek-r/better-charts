import { expect, type Locator, type Page } from '@playwright/test';

/** Right-clicks the middle of the chart pane and returns the chart menu it opens. */
export async function openChartMenu(page: Page): Promise<Locator> {
  const host = (await page.locator('.chart-host').boundingBox())!;
  await page.mouse.click(host.x + host.width / 2, host.y + host.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Chart', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** Clicks the gear in the chart's bottom-right corner and returns the Scales and lines menu it opens. */
export async function openScalesAndLinesMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Chart settings', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Scales and lines', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}
