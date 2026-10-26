import { expect, test, type Page } from '@playwright/test';
import { accountSnapshotFixture, connectBridgeSession } from './helpers/bridgeConnect';
import { drawingToolbar } from './helpers/drawingToolbarPage';
import { position, profileState, ready, requests, respond, select } from './helpers/fixedRangeProfilePage';
import { chooseSearchResult, openSymbolSearch } from './helpers/panel';
import { savedProfile } from './helpers/savedProfile';
import {
  brokerSymbolFixture,
  chartDrawingSaveCount,
  chartDrawingScopeKey,
  expectNoErrors,
  gotoWithStub,
  pushEvent,
  storedDrawingIds,
  stubChartDrawings,
  stubInvocations,
} from './helpers/tauriStub';

/**
 * Drawings survive everything that empties the chart: a page reload, a symbol switch, a
 * timeframe switch and an account switch. The Rust backend keeps one list per account and
 * symbol, so each set comes back with its ids, lock flags and points, and only under the
 * account and symbol that drew it.
 */

/** The account the stub's bridge status, account snapshot and portfolio all report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';

const eurusd = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar');
const nas100 = brokerSymbolFixture('NAS100', 'US Tech 100');

/** The chart's drawings as the dev hook reports them. */
async function drawings(page: Page) {
  return page.evaluate(() => window.__chartTest?.drawings() ?? []);
}

/** The symbols the app asked the backend to save, oldest first. */
async function savedSymbols(page: Page): Promise<string[]> {
  const saves = (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_drawings');
  return saves.map((entry) => String(entry.args.symbol));
}

/** Boots the app with one seeded drawing saved under the drawing account and symbol. */
async function gotoWithSavedProfile(page: Page, record: ReturnType<typeof savedProfile>): Promise<void> {
  await gotoWithStub(page, {
    chartDrawings: { [chartDrawingScopeKey(ACCOUNT_KEY, 'EURUSD')]: [record] },
  });
}

/** Commits one profile drawing on the default window through real pointer events. */
async function placeProfile(page: Page): Promise<void> {
  await ready(page);
  await select(page);
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await respond(page);
  await expect.poll(async () => (await profileState(page)).hasProfile).toBe(true);
}

/** Picks a symbol through the header search, which is how the bridge is asked for another window. */
async function switchSymbol(page: Page, symbol: string): Promise<void> {
  const { dialog, input } = await openSymbolSearch(page);
  await input.fill(symbol);
  await expect(dialog.locator('.search-result-row')).toHaveCount(1);
  await chooseSearchResult(dialog, symbol);
  await expect(dialog).toBeHidden();
  await expect(page.locator('.chart-heading h1')).toHaveText(symbol);
}

/** One drawing as the chart's dev hook reports it. */
type ChartDrawingSnapshot = Awaited<ReturnType<typeof drawings>>[number];

/** Places one profile drawing and returns it once the backend holds it under the account. */
async function placeStoredProfile(page: Page): Promise<ChartDrawingSnapshot> {
  await placeProfile(page);
  const [placed] = await drawings(page);
  await expect.poll(() => storedDrawingIds(page, ACCOUNT_KEY, 'EURUSD')).toEqual([placed.id]);
  return placed;
}

/** Waits until the chart shows the placed drawing again, with its id and the points it was drawn with. */
async function expectDrawingRestored(page: Page, placed: ChartDrawingSnapshot): Promise<void> {
  await expect.poll(async () => (await drawings(page)).map((record) => record.id)).toEqual([placed.id]);
  expect((await drawings(page))[0].points).toEqual(placed.points);
}

test('a placed drawing returns with its id and points after a reload of the same account', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const placed = await placeStoredProfile(page);

  await page.reload();

  await expectDrawingRestored(page, placed);
  expectNoErrors(collected);
});

test('a drawing saved as locked comes back locked, with its points and settings', async ({ page }) => {
  const locked = savedProfile('locked-profile', { locked: true, visible: true });
  await gotoWithSavedProfile(page, locked);

  await expect.poll(async () => (await drawings(page)).length).toBe(1);
  const [restored] = await drawings(page);
  expect(restored).toMatchObject({ id: 'locked-profile', toolId: 'fixedRangeProfile', locked: true, inputs: {} });
  expect(restored.points).toEqual(locked.points);
});

test('a drawing saved as hidden comes back hidden, and the chart picks nothing where it lies', async ({ page }) => {
  const hidden = savedProfile('hidden-profile', { locked: false, visible: false });
  await gotoWithSavedProfile(page, hidden);
  await ready(page);

  await expect.poll(async () => (await drawings(page)).length).toBe(1);
  expect((await drawings(page))[0].visible).toBe(false);

  const spot = await position(page, 4);
  await page.mouse.click(spot.x, spot.y);

  await expect(drawingToolbar(page)).toHaveCount(0);
  expect((await drawings(page)).map((record) => record.id)).toEqual(['hidden-profile']);
});

test('a symbol switch hides the drawings of the symbol left and brings them back on return', async ({ page }) => {
  const collected = await gotoWithStub(page, { brokerSymbols: [eurusd, nas100] });
  const placed = await placeStoredProfile(page);

  await switchSymbol(page, 'NAS100');
  await expect.poll(async () => (await drawings(page)).length).toBe(0);
  // Leaving a symbol writes nothing into its list, and the symbol arrived at has none.
  expect(await storedDrawingIds(page, ACCOUNT_KEY, 'EURUSD')).toEqual([placed.id]);
  expect(await storedDrawingIds(page, ACCOUNT_KEY, 'NAS100')).toEqual([]);
  expect(await savedSymbols(page)).not.toContain('NAS100');

  await switchSymbol(page, 'EURUSD');
  await expectDrawingRestored(page, placed);
  expectNoErrors(collected);
});

test('a timeframe switch keeps the drawing and saves nothing', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const placed = await placeStoredProfile(page);
  const savesAfterPlacement = await chartDrawingSaveCount(page);
  expect(savesAfterPlacement).toBeGreaterThan(0);

  await page.getByRole('button', { name: '15m', exact: true }).click();
  await expect(page.locator('.timeframe-tabs button[aria-pressed="true"]')).toHaveText('15m');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').at(-1)?.args)
    .toMatchObject({ symbol: 'EURUSD', timeframe: 'M15' });
  // The M15 window lands a tick after its request, so wait for it before counting saves again.
  await page.waitForTimeout(250);

  expect((await drawings(page)).map((record) => record.id)).toEqual([placed.id]);
  expect(await chartDrawingSaveCount(page)).toBe(savesAfterPlacement);
  expectNoErrors(collected);
});

test("another account sees none of the first account's drawings", async ({ page }) => {
  const collected = await gotoWithStub(page);
  const placed = await placeStoredProfile(page);

  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'account identity changed' });
  await connectBridgeSession(page, accountSnapshotFixture({ accountLogin: '50999999', brokerServer: 'Broker-Live' }));

  await expect(page.locator('.topbar-actions .account-badge')).toHaveText(/^50999999 /);
  await expect.poll(async () => (await drawings(page)).length).toBe(0);
  // The drawing stays saved under the account that drew it, and the other account has no list.
  expect(await storedDrawingIds(page, ACCOUNT_KEY, 'EURUSD')).toEqual([placed.id]);
  expect(Object.keys(await stubChartDrawings(page))).toEqual([chartDrawingScopeKey(ACCOUNT_KEY, 'EURUSD')]);
  expectNoErrors(collected);
});

test('a saved file the backend cannot read is reported and never overwritten', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    unreadableChartDrawings: [chartDrawingScopeKey(ACCOUNT_KEY, 'EURUSD')],
  });

  await expect(
    page.locator('.notification-region [role=alert]').filter({ hasText: 'Saved drawings could not be read' }),
  ).toBeVisible();

  // The edit lands on the chart, but the file it could not read is left exactly as it is.
  await placeProfile(page);
  await expect.poll(async () => (await drawings(page)).length).toBe(1);
  expect(await chartDrawingSaveCount(page)).toBe(0);
  expect(await stubChartDrawings(page)).toEqual({});
  expectNoErrors(collected);
});
