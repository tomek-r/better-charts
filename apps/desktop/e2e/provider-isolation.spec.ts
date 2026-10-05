import { expect, test, type Page } from '@playwright/test';
import { deriveOrderRiskBasis } from '../src/features/order-ticket/riskBasis';
import { gotoWithStub } from './tauriStub';

interface ProbeCounts {
  [name: string]: number;
}

async function mountHarness(page: Page) {
  await gotoWithStub(page);
  await page.evaluate(async () => {
    // Keep production UI out of this independent provider harness's hit targets.
    const appRoot = document.getElementById('root');
    if (appRoot) {
      appRoot.style.display = 'none';
    }
    const harnessPath = '/e2e/providerIsolationHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    const container = document.createElement('div');
    container.id = 'provider-isolation-harness';
    document.body.append(container);
    harness.mountProviderIsolationHarness(container);
  });
  await expect(page.getByTestId('provider-probe-ready')).toBeVisible();
  await expect(page.getByTestId('probe-settings')).toContainText('127.0.0.1:8765');
  await page.evaluate(() =>
    (window as unknown as { __resetProviderProbeCounts: () => void }).__resetProviderProbeCounts(),
  );
}

async function probeCounts(page: Page): Promise<ProbeCounts> {
  return page.evaluate(() => (window as unknown as { __providerProbeCounts: ProbeCounts }).__providerProbeCounts);
}

test('quote updates rerender market and ticket consumers without waking unrelated domains', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Update quote' }).click();
  await expect(page.getByTestId('probe-market')).toHaveText('1.0852');

  const counts = await probeCounts(page);
  expect(counts.market).toBeGreaterThan(0);
  expect(counts['bridge-runtime']).toBeGreaterThan(0);
  expect(counts['ticket-edit']).toBeGreaterThan(0);
  expect(counts.account ?? 0).toBe(0);
  expect(counts.portfolio ?? 0).toBe(0);
  expect(counts.settings ?? 0).toBe(0);
  expect(counts.header ?? 0).toBe(0);
  expect(counts['chart-resources'] ?? 0).toBe(0);
  await expect(page.getByTestId('probe-chart-header').locator('.quote-cards b').first()).toHaveText('1.0852');
  expect(counts['chart-quotes']).toBeGreaterThan(0);
  expect(counts['chart-title'] ?? 0).toBe(0);
  expect(counts['chart-timeframes'] ?? 0).toBe(0);
  expect(counts['chart-canvas'] ?? 0).toBe(0);
});

test('ticket edits and panel toggles update only their owning consumers', async ({ page }) => {
  await mountHarness(page);

  await page.getByRole('button', { name: 'Edit ticket' }).click();
  await expect(page.getByTestId('probe-ticket-edit')).toHaveText('1.2345');
  const ticketCounts = await probeCounts(page);
  expect(ticketCounts['ticket-edit']).toBeGreaterThan(0);
  expect(ticketCounts.market ?? 0).toBe(0);
  expect(ticketCounts.account ?? 0).toBe(0);
  expect(ticketCounts.settings ?? 0).toBe(0);
  expect(ticketCounts.header ?? 0).toBe(0);
  expect(ticketCounts['chart-resources'] ?? 0).toBe(0);

  await page.evaluate(() =>
    (window as unknown as { __resetProviderProbeCounts: () => void }).__resetProviderProbeCounts(),
  );
  await page.getByRole('button', { name: 'Toggle panel' }).click();
  await expect(page.getByTestId('probe-panel')).toHaveText('true');
  const panelCounts = await probeCounts(page);
  expect(panelCounts.panel).toBeGreaterThan(0);
  expect(panelCounts.header).toBeGreaterThan(0);
  expect(panelCounts.settings ?? 0).toBe(0);
  expect(panelCounts.market ?? 0).toBe(0);
  expect(panelCounts['chart-resources'] ?? 0).toBe(0);
});

test('candle updates with unchanged chart identity keep title and timeframe consumers idle', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Load candle' }).click();
  await expect(page.getByTestId('probe-candle-close')).toHaveText('1.0850');
  await page.evaluate(() =>
    (window as unknown as { __resetProviderProbeCounts: () => void }).__resetProviderProbeCounts(),
  );
  await page.getByRole('button', { name: 'Update candle' }).click();
  await expect(page.getByTestId('probe-candle-close')).toHaveText('1.0852');

  const counts = await probeCounts(page);
  expect(counts.market).toBeGreaterThan(0);
  expect(counts['chart-title'] ?? 0).toBe(0);
  expect(counts['chart-timeframes'] ?? 0).toBe(0);
  expect(counts['chart-canvas'] ?? 0).toBe(0);
});

test('settings updates do not rerender the header action consumer', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Save settings state' }).click();
  await expect(page.getByTestId('probe-settings')).toContainText('restart:true');

  const counts = await probeCounts(page);
  expect(counts.settings).toBeGreaterThan(0);
  expect(counts.header ?? 0).toBe(0);
  expect(counts.market ?? 0).toBe(0);
});

test('risk basis keeps equity sizing derived from valid positive account equity', () => {
  expect(
    deriveOrderRiskBasis({
      unitsMode: 'equity',
      riskAmount: '1.5',
      equity: '10000.00',
      currency: 'USD',
      stagedOnChart: false,
    }),
  ).toEqual({
    riskMode: 'equity',
    effectiveRiskAmount: '150.00',
    equityValue: 10000,
    riskModeHint: '≈ 150.00 USD',
  });
  expect(
    deriveOrderRiskBasis({
      unitsMode: 'equity',
      riskAmount: '1.5',
      equity: '0',
      currency: 'USD',
      stagedOnChart: true,
    }),
  ).toEqual({
    riskMode: 'equity',
    effectiveRiskAmount: '',
    equityValue: undefined,
    riskModeHint: 'Account data required',
  });
});

test('typing in search keeps bridge, ticket, settings and header consumers idle', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Search symbols', exact: true }).click();
  const input = page.getByRole('dialog', { name: 'Search symbols' }).getByPlaceholder('Search symbol — e.g. NAS100');
  await input.fill('EUR');
  await expect(input).toHaveValue('EUR');
  const counts = await probeCounts(page);
  expect(counts.market ?? 0).toBe(0);
  expect(counts['bridge-runtime'] ?? 0).toBe(0);
  expect(counts['ticket-edit'] ?? 0).toBe(0);
  expect(counts.header ?? 0).toBe(0);
  expect(counts.settings ?? 0).toBe(0);
  expect(counts['chart-resources'] ?? 0).toBe(0);
});
