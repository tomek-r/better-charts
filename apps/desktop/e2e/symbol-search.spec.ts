import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent, stubInvocations } from './tauriStub';

const brokerSymbol = (symbol: string, description: string) => ({
  symbol,
  description,
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  contractSize: '100000',
  tickValueProfit: '1.00000',
  tickValueLoss: '1.00000',
  tickValueCurrency: 'USD',
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

test('a delayed search failure cannot replace results from a newer query', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  const input = dialog.getByPlaceholder('Search symbol — e.g. NAS100');

  await page.evaluate(() => {
    const internals = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      __rejectFirstSearch?: () => void;
      __searchCalls?: string[];
    };
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'search_symbols') {
        (internals.__searchCalls ??= []).push(String(args?.query));
      }
      if (cmd === 'search_symbols' && args?.query === 'FIRST') {
        return new Promise((_, reject) => {
          internals.__rejectFirstSearch = () => reject(new Error('delayed failure'));
        });
      }
      if (cmd === 'search_symbols') {
        return Promise.resolve(null);
      }
      return invoke(cmd, args);
    };
  });

  await input.fill('FIRST');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __searchCalls: string[] }).__searchCalls))
    .toEqual(['FIRST']);
  await input.fill('SECOND');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __searchCalls: string[] }).__searchCalls))
    .toEqual(['FIRST', 'SECOND']);

  await pushEvent(page, 'symbol-search-result', {
    query: 'SECOND',
    source: 'live',
    symbols: [brokerSymbol('SECOND', 'Newer query result')],
  });
  await expect(dialog.getByText('Newer query result')).toBeVisible();

  await page.evaluate(() => {
    const internals = window as unknown as { __rejectFirstSearch?: () => void };
    internals.__rejectFirstSearch?.();
  });

  await page.waitForTimeout(25);
  await expect(dialog.getByText('Newer query result')).toBeVisible();
  await expect(page.getByText('Symbol search is unavailable.')).toHaveCount(0);
});

test('a search failure from before close cannot affect the same query after reopening', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  const input = dialog.getByPlaceholder('Search symbol — e.g. NAS100');

  await page.evaluate(() => {
    const internals = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      __rejectOldSearch?: () => void;
      __searchCalls?: string[];
    };
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== 'search_symbols') {
        return invoke(cmd, args);
      }
      const calls = (internals.__searchCalls ??= []);
      calls.push(String(args?.query));
      if (calls.length === 1) {
        return new Promise((_, reject) => {
          internals.__rejectOldSearch = () => reject(new Error('delayed failure'));
        });
      }
      return Promise.resolve(null);
    };
  });

  await input.fill('SAME');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __searchCalls: string[] }).__searchCalls))
    .toEqual(['SAME']);
  await dialog.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __searchCalls: string[] }).__searchCalls))
    .toEqual(['SAME', 'SAME']);

  await pushEvent(page, 'symbol-search-result', {
    query: 'SAME',
    source: 'live',
    symbols: [brokerSymbol('SAME', 'Reopened query result')],
  });
  await expect(dialog.getByText('Reopened query result')).toBeVisible();

  await page.evaluate(() => {
    const internals = window as unknown as { __rejectOldSearch?: () => void };
    internals.__rejectOldSearch?.();
  });

  await page.waitForTimeout(25);
  await expect(dialog.getByText('Reopened query result')).toBeVisible();
  await expect(page.getByText('Symbol search is unavailable.')).toHaveCount(0);
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
      tickValueProfit: '0.00001',
      tickValueLoss: '0.00001',
      tickValueCurrency: 'USD',
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
