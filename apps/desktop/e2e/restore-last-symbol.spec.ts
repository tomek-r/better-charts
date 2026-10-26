import { expect, test, type Page } from '@playwright/test';
import { accountSnapshotFixture, connectBridgeSession } from './helpers/bridgeConnect';
import { blockedStorage, fixedStorage, memoryStorage } from './helpers/memoryStorage';
import { readStoredJson, seedStoredValue } from './helpers/pageStorage';
import { brokerSymbolFixture, expectNoErrors, gotoWithStub, pushEvent, stubInvocations } from './helpers/tauriStub';
import { chooseSearchResult, openSymbolSearch } from './helpers/panel';
import {
  accountIdentityKey,
  isSameChartSelection,
  lastChartSelectionKey,
  loadLastChartSelection,
  restorableSelection,
  saveLastChartSelection,
  type LastChartSelection,
} from '../src/features/bridge/lastChartSelection';

// The account the stub's bridge status, account snapshot and portfolio all report.
const ACCOUNT_KEY = '50123456@Broker-Demo';

const eurusd = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar');
const nas100 = brokerSymbolFixture('NAS100', 'US Tech 100');

const heading = (page: Page) => page.locator('.chart-heading h1');
const timeframeButton = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button', { name: label, exact: true });

/** The window a session opens when nothing is restored. */
async function expectDefaultWindow(page: Page): Promise<void> {
  await expect(heading(page)).toHaveText('EURUSD');
  await expect(timeframeButton(page, '5m')).toHaveAttribute('aria-pressed', 'true');
}

/** Writes a raw value under the saved-selection key once, so a reload keeps what the app stored. */
async function seedSavedSelection(page: Page, selections: Record<string, LastChartSelection>): Promise<void> {
  await seedStoredValue(page, lastChartSelectionKey, JSON.stringify(selections));
}

async function storedSelection(page: Page, accountKey: string) {
  const stored = (await readStoredJson(page, lastChartSelectionKey)) as Record<string, unknown>;
  return stored[accountKey];
}

/** The queries the app sent to the broker's symbol list. */
async function symbolLookups(page: Page): Promise<unknown[]> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'search_symbols').map((entry) => entry.args.query);
}

async function historyRequestCount(page: Page): Promise<number> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'request_history').length;
}

/** The default window opened and the broker's symbol list was never consulted. */
async function expectDefaultWithoutLookup(page: Page): Promise<void> {
  await expectDefaultWindow(page);
  await expect.poll(() => historyRequestCount(page)).toBeGreaterThan(0);
  expect(await symbolLookups(page)).toEqual([]);
}

test('an account identity needs both the login and the broker server', () => {
  expect(accountIdentityKey('50123456', 'Broker-Demo')).toBe(ACCOUNT_KEY);
  expect(accountIdentityKey(' 50123456 ', ' Broker-Demo ')).toBe(ACCOUNT_KEY);
  expect(accountIdentityKey(undefined, 'Broker-Demo')).toBeUndefined();
  expect(accountIdentityKey('50123456', undefined)).toBeUndefined();
  expect(accountIdentityKey('', 'Broker-Demo')).toBeUndefined();
  expect(accountIdentityKey('50123456', '   ')).toBeUndefined();
});

test('one window per account round-trips, and storage holds nothing else about it', () => {
  const storage = memoryStorage();
  expect(loadLastChartSelection(undefined, storage)).toBeUndefined();
  expect(loadLastChartSelection(ACCOUNT_KEY, storage)).toBeUndefined();
  saveLastChartSelection(undefined, { symbol: 'NAS100', timeframe: 'M15' }, storage);
  expect(storage.getItem(lastChartSelectionKey)).toBeNull();

  saveLastChartSelection(ACCOUNT_KEY, { symbol: 'NAS100', timeframe: 'M15' }, storage);
  saveLastChartSelection('70001234@Broker-Live', { symbol: 'GBPUSD', timeframe: 'H1' }, storage);
  expect(loadLastChartSelection(ACCOUNT_KEY, storage)).toEqual({ symbol: 'NAS100', timeframe: 'M15' });
  expect(loadLastChartSelection('70001234@Broker-Live', storage)).toEqual({ symbol: 'GBPUSD', timeframe: 'H1' });

  saveLastChartSelection(ACCOUNT_KEY, { symbol: 'EURUSD', timeframe: 'M5' }, storage);
  expect(loadLastChartSelection(ACCOUNT_KEY, storage)).toEqual({ symbol: 'EURUSD', timeframe: 'M5' });
  expect(JSON.parse(storage.getItem(lastChartSelectionKey) ?? '{}')).toEqual({
    [ACCOUNT_KEY]: { symbol: 'EURUSD', timeframe: 'M5' },
    '70001234@Broker-Live': { symbol: 'GBPUSD', timeframe: 'H1' },
  });
});

test('malformed, foreign or unreadable storage reads as no saved window', () => {
  for (const raw of [
    '{not json',
    '[]',
    '"NAS100"',
    'null',
    '{"50123456@Broker-Demo": 7}',
    '{"50123456@Broker-Demo": {"symbol": "NAS100"}}',
    '{"50123456@Broker-Demo": {"symbol": 42, "timeframe": "M15"}}',
  ]) {
    expect(loadLastChartSelection(ACCOUNT_KEY, fixedStorage(raw))).toBeUndefined();
  }
  expect(loadLastChartSelection(ACCOUNT_KEY, blockedStorage)).toBeUndefined();

  // A broken neighbour does not hide a readable entry.
  const neighbours = '{"50123456@Broker-Demo":{"symbol":"NAS100","timeframe":"M15"},"x":null}';
  const readable = loadLastChartSelection(ACCOUNT_KEY, fixedStorage(neighbours));
  expect(readable).toEqual({ symbol: 'NAS100', timeframe: 'M15' });
  // Unreadable storage is replaced by the next save instead of staying broken.
  const storage = memoryStorage({ [lastChartSelectionKey]: '{not json' });
  saveLastChartSelection(ACCOUNT_KEY, { symbol: 'NAS100', timeframe: 'M15' }, storage);
  expect(loadLastChartSelection(ACCOUNT_KEY, storage)).toEqual({ symbol: 'NAS100', timeframe: 'M15' });
});

test('a saved window is restorable only on a timeframe the config and the handshake serve', () => {
  const saved = { symbol: 'NAS100', timeframe: 'M15' };
  expect(restorableSelection(saved, ['M1', 'M15'])).toEqual(saved);
  expect(restorableSelection(saved, undefined)).toEqual(saved);
  // An empty handshake list means "not reported", so the config codes stand.
  expect(restorableSelection(saved, [])).toEqual(saved);
  expect(restorableSelection(saved, ['M1', 'H1'])).toBeUndefined();
  expect(restorableSelection({ symbol: 'NAS100', timeframe: 'BOGUS' }, undefined)).toBeUndefined();
  expect(restorableSelection(undefined, undefined)).toBeUndefined();
  expect(isSameChartSelection(saved, { symbol: 'NAS100', timeframe: 'M15' })).toBe(true);
  expect(isSameChartSelection(saved, { symbol: 'NAS100', timeframe: 'M5' })).toBe(false);
  expect(isSameChartSelection(saved, undefined)).toBe(false);
});

test('the same account reopens the symbol and timeframe it was watching after a restart', async ({ page }) => {
  const collected = await gotoWithStub(page, { brokerSymbols: [eurusd, nas100] });
  const { dialog, input } = await openSymbolSearch(page);
  await input.fill('NAS100');
  await expect(dialog.locator('.search-result-row')).toHaveCount(1);
  await chooseSearchResult(dialog, 'NAS100');
  await expect(heading(page)).toHaveText('NAS100');
  await timeframeButton(page, '15m').click();
  await expect(timeframeButton(page, '15m')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => storedSelection(page, ACCOUNT_KEY)).toEqual({ symbol: 'NAS100', timeframe: 'M15' });

  await page.reload();

  await expect(heading(page)).toHaveText('NAS100');
  await expect(timeframeButton(page, '15m')).toHaveAttribute('aria-pressed', 'true');
  const historyRequests = (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history');
  expect(historyRequests.at(-1)?.args).toMatchObject({ symbol: 'NAS100', timeframe: 'M15' });
  expectNoErrors(collected);
});

/** The EA connecting after the app started, on the stub's demo account. */
async function connectBridge(page: Page): Promise<void> {
  await connectBridgeSession(page, accountSnapshotFixture(), {
    status: { supportedTimeframes: ['M1', 'M5', 'M15', 'H1'] },
  });
}

test('an app started before MT5 connects reopens the saved window once, on the first connection', async ({ page }) => {
  await seedSavedSelection(page, { [ACCOUNT_KEY]: { symbol: 'NAS100', timeframe: 'M15' } });
  const collected = await gotoWithStub(page, {
    brokerSymbols: [eurusd, nas100],
    responses: { get_bridge_status: { state: 'disconnected' }, get_account_snapshot: null },
  });
  expect(await historyRequestCount(page)).toBe(0);

  await connectBridge(page);

  await expect(heading(page)).toHaveText('NAS100');
  await expect(timeframeButton(page, '15m')).toHaveAttribute('aria-pressed', 'true');

  // A later reconnect keeps the session's own window instead of restoring again.
  await pushEvent(page, 'bridge-status', { state: 'disconnected' });
  await connectBridge(page);
  await expectDefaultWindow(page);
  expectNoErrors(collected);
});

for (const [label, otherAccountKey] of [
  ['login', '50999999@Broker-Demo'],
  ['server', '50123456@Broker-Live'],
] as const) {
  test(`a saved window of another ${label} never replaces this account's default`, async ({ page }) => {
    await seedSavedSelection(page, { [otherAccountKey]: { symbol: 'NAS100', timeframe: 'M15' } });
    await gotoWithStub(page, { brokerSymbols: [eurusd, nas100] });

    await expectDefaultWithoutLookup(page);
  });
}

test('a saved symbol the broker does not list keeps the session default', async ({ page }) => {
  await seedSavedSelection(page, { [ACCOUNT_KEY]: { symbol: 'NAS100', timeframe: 'M15' } });
  const collected = await gotoWithStub(page, { brokerSymbols: [eurusd] });

  await expectDefaultWindow(page);
  await expect.poll(() => symbolLookups(page)).toEqual(['NAS100']);
  expectNoErrors(collected);
});

test('a saved timeframe outside config/timeframes.json keeps the session default', async ({ page }) => {
  await seedSavedSelection(page, { [ACCOUNT_KEY]: { symbol: 'NAS100', timeframe: 'BOGUS' } });
  await gotoWithStub(page, { brokerSymbols: [eurusd, nas100] });

  // An unusable timeframe is rejected before the broker is asked about the symbol.
  await expectDefaultWithoutLookup(page);
});

test('a saved timeframe the handshake does not advertise keeps the session default', async ({ page }) => {
  await seedSavedSelection(page, { [ACCOUNT_KEY]: { symbol: 'NAS100', timeframe: 'M15' } });
  await gotoWithStub(page, {
    brokerSymbols: [eurusd, nas100],
    responses: { get_bridge_status: { state: 'connected', supportedTimeframes: ['M1', 'M5', 'MN1'] } },
  });

  await expectDefaultWithoutLookup(page);
});

for (const [label, raw] of [
  ['broken JSON', '{not json'],
  ['an entry that is not a window', JSON.stringify({ [ACCOUNT_KEY]: { symbol: 'NAS100' } })],
] as const) {
  test(`malformed saved storage (${label}) keeps the default and never crashes`, async ({ page }) => {
    await seedStoredValue(page, lastChartSelectionKey, raw);
    const collected = await gotoWithStub(page);

    await expectDefaultWindow(page);
    expectNoErrors(collected);
  });
}
