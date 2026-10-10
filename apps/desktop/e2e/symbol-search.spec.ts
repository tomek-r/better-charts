import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch } from './helpers/panel';
import { brokerSymbolFixture, gotoWithStub, pushEvent, stubInvocations, type StubInternals } from './helpers/tauriStub';

// Headless Chromium hides scrollbars by default; keep them visible for layout checks and screenshots.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/** The stub's Tauri global plus the hooks the delayed-search specs install in the page. */
type SearchInternals = StubInternals & {
  __rejectFirstSearch?: () => void;
  __searchCalls?: string[];
};

/**
 * Records every `search_symbols` query in `__searchCalls`, leaves the first one
 * pending until `__rejectFirstSearch()` fails it, and answers later ones with null.
 */
async function hangFirstSearch(page: Page) {
  await page.evaluate(() => {
    const internals = window as unknown as SearchInternals;
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== 'search_symbols') {
        return invoke(cmd, args);
      }
      const calls = (internals.__searchCalls ??= []);
      calls.push(String(args?.query));
      if (calls.length === 1) {
        return new Promise((_, reject) => {
          internals.__rejectFirstSearch = () => reject(new Error('delayed failure'));
        });
      }
      return Promise.resolve(null);
    };
  });
}

async function expectSearchCalls(page: Page, calls: string[]) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __searchCalls: string[] }).__searchCalls))
    .toEqual(calls);
}

/** Fails the held first search late, then checks the newer result stays and no error appears. */
async function expectLateFailureIgnored(page: Page, dialog: Locator, resultText: string) {
  await page.evaluate(() => {
    const internals = window as unknown as { __rejectFirstSearch?: () => void };
    internals.__rejectFirstSearch?.();
  });
  await page.waitForTimeout(25);
  await expect(dialog.getByText(resultText)).toBeVisible();
  await expect(page.getByText('Symbol search is unavailable.')).toHaveCount(0);
}

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
  const eur = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar');
  const usd = brokerSymbolFixture('USDJPY', 'US Dollar vs Japanese Yen');
  await pushEvent(page, 'symbol-search-result', { query: 'EUR', source: 'live', symbols: [eur] });
  await expect(dialog.getByText('Euro vs US Dollar')).toHaveCount(0);
  await pushEvent(page, 'symbol-search-result', { query: 'USD', source: 'live', symbols: [usd] });
  await expect(dialog.getByText('US Dollar vs Japanese Yen')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close search' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expect(dialog).toBeVisible();
});

test('long symbol results expose a scrollbar and the last result remains reachable', async ({ page }, testInfo) => {
  const { pageErrors, consoleErrors } = await gotoWithStub(page);
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(
    page,
    input,
    'TEST',
    Array.from({ length: 20 }, (_, index) => brokerSymbolFixture(`TEST${index}`, `Test symbol ${index}`)),
  );
  const results = dialog.locator('.search-results');
  await expect(results.locator('.search-result-row')).toHaveCount(20);
  const scrolling = await results.evaluate((element) => ({
    height: element.clientHeight,
    contentHeight: element.scrollHeight,
    scrollbarSpace: element.getBoundingClientRect().width - element.clientWidth,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
    scrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
    thumbColor: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
  }));
  expect(scrolling.contentHeight).toBeGreaterThan(scrolling.height);
  expect(scrolling.scrollbarSpace).toBeGreaterThan(0);
  expect(scrolling.scrollbarWidth).not.toBe('none');
  expect(scrolling.scrollbarDisplay).not.toBe('none');
  expect(scrolling.thumbColor).toBe('rgb(43, 56, 75)');
  await results.screenshot({ path: testInfo.outputPath('search-results-scrollbar.png') });
  const last = results.getByRole('button', { name: 'TEST19 Test symbol 19', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('favorite stars keep their column when toggled beside long descriptions', async ({ page }) => {
  await gotoWithStub(page);
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'TEST', [
    brokerSymbolFixture('TEST', 'Short description'),
    brokerSymbolFixture('TEST_LONG', 'ExtremelyLongUnbrokenBrokerDescriptionThatDoesNotFitInTheAvailableSpaceAtAll'),
  ]);
  const normal = dialog.getByRole('button', { name: 'Add TEST to favorites', exact: true });
  const toggle = dialog.getByRole('button', { name: 'Add TEST_LONG to favorites', exact: true });
  const before = await toggle.boundingBox();
  const normalBox = await normal.boundingBox();
  expect(before).not.toBeNull();
  expect(normalBox).not.toBeNull();
  expect(before!.x).toBeCloseTo(normalBox!.x, 0);
  expect(before!.width).toBeCloseTo(normalBox!.width, 0);
  await toggle.click();
  const selected = dialog.getByRole('button', { name: 'Remove TEST_LONG from favorites', exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const after = await selected.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.width).toBeCloseTo(before!.width, 0);
  await selected.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect((await toggle.boundingBox())!.x).toBeCloseTo(before!.x, 0);
});

test('favorite stars do not move horizontally when removing rows ends overflow', async ({ page }) => {
  const favorites = Array.from({ length: 8 }, (_, index) =>
    brokerSymbolFixture(`TEST${index}`, `Test symbol ${index}`),
  );
  await page.addInitScript((symbols) => {
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify(symbols));
  }, favorites);
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  const results = dialog.locator('.search-results');
  const retained = dialog.getByRole('button', { name: 'Remove TEST0 from favorites', exact: true });
  const before = await retained.boundingBox();
  expect(await results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  for (let index = 7; index >= 3; index -= 1) {
    await dialog.getByRole('button', { name: `Remove TEST${index} from favorites`, exact: true }).click();
  }
  expect(await results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(false);
  const after = await retained.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.width).toBeCloseTo(before!.width, 0);
});

test('a delayed search failure cannot replace results from a newer query', async ({ page }) => {
  await gotoWithStub(page);
  const { dialog, input } = await openSymbolSearch(page);

  await hangFirstSearch(page);

  await input.fill('FIRST');
  await expectSearchCalls(page, ['FIRST']);
  await input.fill('SECOND');
  await expectSearchCalls(page, ['FIRST', 'SECOND']);

  await pushEvent(page, 'symbol-search-result', {
    query: 'SECOND',
    source: 'live',
    symbols: [brokerSymbolFixture('SECOND', 'Newer query result')],
  });
  await expect(dialog.getByText('Newer query result')).toBeVisible();

  await expectLateFailureIgnored(page, dialog, 'Newer query result');
});

test('a search failure from before close cannot affect the same query after reopening', async ({ page }) => {
  await gotoWithStub(page);
  const { dialog, input } = await openSymbolSearch(page);

  await hangFirstSearch(page);

  await input.fill('SAME');
  await expectSearchCalls(page, ['SAME']);
  await dialog.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Search symbols' }).click();
  await expectSearchCalls(page, ['SAME', 'SAME']);

  await pushEvent(page, 'symbol-search-result', {
    query: 'SAME',
    source: 'live',
    symbols: [brokerSymbolFixture('SAME', 'Reopened query result')],
  });
  await expect(dialog.getByText('Reopened query result')).toBeVisible();

  await expectLateFailureIgnored(page, dialog, 'Reopened query result');
});

test('favorites persist and recents are recorded only after history accepts a selection', async ({ page }) => {
  const favorite = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', {
    contractSize: '1',
    tickValueProfit: '0.00001',
    tickValueLoss: '0.00001',
  });
  await page.addInitScript((saved) => {
    localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([saved]));
  }, favorite);
  await gotoWithStub(page, { historyDelayMs: 900 });
  const { dialog, input } = await openSymbolSearch(page);
  await expect(dialog.getByText('Euro vs US Dollar')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close search' }).click();
  await openSymbolSearch(page);
  await expect(dialog.getByText('Euro vs US Dollar')).toBeVisible();

  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'US Tech 100')]);
  await chooseSearchResult(dialog, 'NAS100');
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

test('empty-query Enter chooses the first favorite and hides it from Recent', async ({ page }) => {
  const favorite = brokerSymbolFixture('EURUSD', 'Saved favorite');
  const recentDuplicate = brokerSymbolFixture('EURUSD', 'Older Euro entry');
  const recent = [recentDuplicate, brokerSymbolFixture('NAS100', 'US Tech 100')];
  await page.addInitScript(
    ({ favoriteSymbol, recentSymbols }) => {
      localStorage.setItem('better-charts.symbol-favorites.v1', JSON.stringify([favoriteSymbol]));
      localStorage.setItem('better-charts.symbol-recent.v1', JSON.stringify(recentSymbols));
    },
    { favoriteSymbol: favorite, recentSymbols: recent },
  );
  await gotoWithStub(page);
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length)
    .toBeGreaterThan(0);
  const initialHistoryCount = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').length;
  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  const rows = dialog.locator('.search-result-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('strong')).toHaveText('EURUSD');
  await expect(rows.nth(1).locator('strong')).toHaveText('NAS100');
  await expect(dialog.getByText('Older Euro entry')).toHaveCount(0);

  await dialog.getByPlaceholder('Search symbol — e.g. NAS100').press('Enter');
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history'))
    .toHaveLength(initialHistoryCount + 1);
  const historyRequests = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history');
  expect(historyRequests.at(-1)?.args.symbol).toBe('EURUSD');
});

test('failed symbol history clears loading and does not record a recent selection', async ({ page }) => {
  await gotoWithStub(page);
  await page.evaluate(() => {
    const internals = window as unknown as StubInternals;
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd === 'request_history' && args?.symbol === 'NAS100'
        ? Promise.reject(new Error('history dispatch failed'))
        : invoke(cmd, args);
  });

  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'US Tech 100')]);
  await chooseSearchResult(dialog, 'NAS100');

  await expect(page.getByText('History request could not be sent.')).toBeVisible();
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('better-charts.symbol-recent.v1') ?? '[]'))).toEqual(
    [],
  );
});

test('a stale symbol history failure cannot affect a newer accepted selection', async ({ page }) => {
  await gotoWithStub(page);
  await page.evaluate(() => {
    const internals = window as unknown as StubInternals & {
      __rejectOldHistory?: () => void;
    };
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'request_history' && args?.symbol === 'OLD') {
        return new Promise((_, reject) => {
          internals.__rejectOldHistory = () => reject(new Error('delayed old history failure'));
        });
      }
      return invoke(cmd, args);
    };
  });

  const selectSearchResult = async (symbol: string) => {
    const { dialog, input } = await openSymbolSearch(page);
    await answerSymbolSearch(
      page,
      input,
      symbol,
      [brokerSymbolFixture(symbol, `${symbol} description`)],
      symbol === 'OLD' ? 1 : 2,
    );
    await chooseSearchResult(dialog, symbol);
  };

  await selectSearchResult('OLD');
  await expect(page.locator('.chart-overlay')).toContainText('Loading market data');
  await selectSearchResult('NEW');
  await expect(page.locator('.chart-heading h1')).toHaveText('NEW');
  await page.evaluate(() => (window as unknown as { __rejectOldHistory?: () => void }).__rejectOldHistory?.());
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))));
  await expect(page.locator('.chart-heading h1')).toHaveText('NEW');
  await expect(page.getByText('History request could not be sent.')).toHaveCount(0);
  await expect(page.locator('.chart-overlay')).toHaveCount(0);
  const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('better-charts.symbol-recent.v1') ?? '[]'));
  expect(recent.map((item: { symbol: string }) => item.symbol)).toEqual(['NEW']);
});
