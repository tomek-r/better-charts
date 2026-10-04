import { expect, type Page } from '@playwright/test';

/**
 * Opens the slide-out trade panel (topbar "Panel" button) and waits until the
 * drawer is visible.
 *
 * Since the fullscreen-chart layout change the drawer is CLOSED by default
 * (`aside.trade-panel` is translated off-screen and visibility-hidden), so
 * every test that asserts or clicks panel content — order ticket, Positions
 * card — must open it first. Idempotent: a test that already opened the panel
 * can call this safely.
 */
export async function openTradePanel(page: Page): Promise<void> {
  const panel = page.locator('aside.trade-panel');
  if (await panel.isVisible()) {
    return;
  }
  await page.getByLabel('Toggle trade panel').click();
  await expect(page.getByLabel('Toggle trade panel')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
}
