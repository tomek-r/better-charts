import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent, stubInvocations } from './tauriStub';

const brokerSymbol = (symbol: string, description: string) => ({
  symbol,
  description,
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  contractSize: '100000',
  volumeMin: '0.01',
  volumeMax: '100',
  volumeStep: '0.01',
  stopsLevel: 0,
  freezeLevel: 0,
  fillingMode: 0,
  orderMode: 0,
  expirationMode: 0,
  tradeExecution: 0,
  tradeMode: 0,
});

test('header and keyboard shortcut open search; debounced results reject stale responses', async ({ page }) => {
  await gotoWithStub(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stub = (window as unknown as { __E2E_TAURI_STUB__: { listenerCount: (event: string) => number } })
          .__E2E_TAURI_STUB__;
        return stub.listenerCount('symbol-search-result');
      }),
    )
    .toBe(1);

  const input = dialog.getByPlaceholder('Search symbol — e.g. NAS100');
  await input.fill('EUR');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'search_symbols'))
    .toHaveLength(1);
  await input.fill('USD');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'search_symbols'))
    .toHaveLength(2);
  const eur = brokerSymbol('EURUSD', 'Euro vs US Dollar');
  const usd = brokerSymbol('USDJPY', 'US Dollar vs Japanese Yen');
  await pushEvent(page, 'symbol-search-result', { query: 'EUR', source: 'live', symbols: [eur] });
  await expect(dialog.getByText('Euro vs US Dollar')).toHaveCount(0);
  await pushEvent(page, 'symbol-search-result', { query: 'USD', source: 'live', symbols: [usd] });
  await expect(dialog.getByText('US Dollar vs Japanese Yen')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close search' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect(dialog).toBeVisible();
});

test('favorites persist and recents are recorded only after history accepts a selection', async ({ page }) => {
  await page.addInitScript(() => {
    const favorite = {
      symbol: 'EURUSD',
      description: 'Euro vs US Dollar',
      digits: 5,
      tickSize: '0.00001',
      pointSize: '0.00001',
      contractSize: '1',
      volumeMin: '0.01',
      volumeMax: '100',
      volumeStep: '0.01',
      stopsLevel: 0,
      freezeLevel: 0,
      fillingMode: 0,
      orderMode: 0,
      expirationMode: 0,
      tradeExecution: 0,
      tradeMode: 0,
    };
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([favorite]));
  });
  await gotoWithStub(page, { historyDelayMs: 900 });
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect(dialog.getByText('Euro vs US Dollar')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect(dialog.getByText('Euro vs US Dollar')).toBeVisible();

  await dialog.getByPlaceholder('Search symbol — e.g. NAS100').fill('NAS100');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'search_symbols'))
    .toHaveLength(1);
  const nasdaq = brokerSymbol('NAS100', 'US Tech 100');
  await pushEvent(page, 'symbol-search-result', { query: 'NAS100', source: 'live', symbols: [nasdaq] });
  await dialog.locator('.search-result-row').filter({ hasText: 'NAS100' }).getByRole('button').first().click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect(dialog.getByRole('button', { name: 'Add NAS100 to favorites' })).toHaveCount(0);

  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100', { timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: 'Add NAS100 to favorites' })).toBeVisible();
  const stored = await page.evaluate(() => ({
    favorites: JSON.parse(localStorage.getItem('better-charts.symbol-favorites.v1') ?? '[]'),
    recent: JSON.parse(localStorage.getItem('better-charts.symbol-recent.v1') ?? '[]'),
  }));
  expect(stored.favorites.map((item: { symbol: string }) => item.symbol)).toEqual(['EURUSD']);
  expect(stored.recent.map((item: { symbol: string }) => item.symbol)).toEqual(['NAS100']);
});
