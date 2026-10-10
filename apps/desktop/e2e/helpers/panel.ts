import { expect, type Locator, type Page } from '@playwright/test';
import type { BrokerSymbol } from '../../src/shared/bridge/types';
import { pushEvent, stubInvocations } from './tauriStub';

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

/** Opens the symbol-search dialog from the header button. */
export async function openSymbolSearch(page: Page): Promise<{ dialog: Locator; input: Locator }> {
  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  return { dialog, input: dialog.getByPlaceholder('Search symbol — e.g. NAS100') };
}

/**
 * Types `query`, waits until the stub has seen `requestCount` search requests in
 * total, then answers with `symbols` as the live result for that query.
 */
export async function answerSymbolSearch(
  page: Page,
  input: Locator,
  query: string,
  symbols: BrokerSymbol[],
  requestCount = 1,
): Promise<void> {
  await input.fill(query);
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'search_symbols'))
    .toHaveLength(requestCount);
  await pushEvent(page, 'symbol-search-result', { query, source: 'live', symbols });
}

/** Clicks the first result row whose text contains `symbol`. */
export async function chooseSearchResult(dialog: Locator, symbol: string): Promise<void> {
  await dialog.locator('.search-result-row').filter({ hasText: symbol }).getByRole('button').first().click();
}

/** Enables a ticket exit, switches its input to price mode and enters `price`. */
export async function fillExitPrice(page: Page, label: 'Take profit' | 'Stop loss', price: string): Promise<void> {
  await page.getByLabel(`${label} enabled`).check();
  await page.getByLabel(`Swap ${label} input to price`).click();
  await page.getByLabel(`${label} price`).fill(price);
}
