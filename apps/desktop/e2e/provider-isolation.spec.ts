import { expect, test, type Locator, type Page } from '@playwright/test';
import { deriveOrderRiskBasis } from '../src/features/order-ticket/domain/riskBasis';
import { gotoWithStub } from './helpers/tauriStub';

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
    const harnessPath = '/e2e/helpers/providerIsolationHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    const container = document.createElement('div');
    container.id = 'provider-isolation-harness';
    document.body.append(container);
    harness.mountProviderIsolationHarness(container);
  });
  await expect(page.getByTestId('provider-probe-ready')).toBeVisible();
  await expect(page.getByTestId('probe-settings')).toContainText('127.0.0.1:8765');
  await resetProbeCounts(page);
}

async function resetProbeCounts(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __resetProviderProbeCounts: () => void }).__resetProviderProbeCounts(),
  );
}

/** Re-arms the action gate, then checks that `button` moves the action consumer to `text` and rerenders it. */
async function expectActionRerender(page: Page, action: Locator, button: string, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Prepare action gate' }).click();
  await expect(action).toHaveText('true|false|buy');
  await resetProbeCounts(page);
  await page.getByRole('button', { name: button }).click();
  await expect(action).toHaveText(text);
  expect((await probeCounts(page))['ticket-action']).toBeGreaterThan(0);
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
  expect(counts['bridge-lifecycle-runtime'] ?? 0).toBe(0);
  expect(counts['ticket-edit']).toBeGreaterThan(0);
  expect(counts['ticket-quotes']).toBeGreaterThan(0);
  expect(counts['ticket-extra-settings'] ?? 0).toBe(0);
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
  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Update quote' }).click();
  await expect(page.getByTestId('probe-market')).toHaveText('1.0852');
  const identicalQuoteCounts = await probeCounts(page);
  expect(identicalQuoteCounts['bridge-lifecycle-runtime'] ?? 0).toBe(0);
  expect(identicalQuoteCounts['ticket-quotes'] ?? 0).toBe(0);
  expect(identicalQuoteCounts['chart-quotes'] ?? 0).toBe(0);
  expect(identicalQuoteCounts['ticket-edit'] ?? 0).toBe(0);
  expect(identicalQuoteCounts['ticket-extra-settings'] ?? 0).toBe(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Move quote' }).click();
  await expect(page.getByTestId('probe-market')).toHaveText('1.08530');
  const changedQuoteCounts = await probeCounts(page);
  expect(changedQuoteCounts['bridge-lifecycle-runtime'] ?? 0).toBe(0);
  expect(changedQuoteCounts['ticket-quotes']).toBeGreaterThan(0);
  expect(changedQuoteCounts['ticket-edit'] ?? 0).toBe(0);
  expect(changedQuoteCounts['ticket-extra-settings'] ?? 0).toBe(0);
});

test('bridge domain stores remain isolated across provider instances', async ({ page }) => {
  await mountHarness(page);

  await page.getByRole('button', { name: 'Update quote' }).click();
  await expect(page.getByTestId('secondary-quote')).toHaveText('none');
  await page.getByRole('button', { name: 'Set test account' }).click();
  await expect(page.getByTestId('secondary-account')).toHaveText('none');
  await page.getByRole('button', { name: 'Set test portfolio' }).click();
  await expect(page.getByTestId('secondary-portfolio')).toHaveText('none');

  const counts = await probeCounts(page);
  expect(counts['secondary-market'] ?? 0).toBe(0);
  await expect(page.getByTestId('secondary-market')).toHaveText('none');
});

test('bridge runtime projection reads current state from each canonical domain store', async ({ page }) => {
  await mountHarness(page);

  await page.getByRole('button', { name: 'Set test bridge status' }).click();
  await page.getByRole('button', { name: 'Mark Tauri unavailable' }).click();
  await page.getByRole('button', { name: 'Update quote' }).click();
  await page.getByRole('button', { name: 'Load candle' }).click();
  await page.getByRole('button', { name: 'Update candle' }).click();
  await page.getByRole('button', { name: 'Set test account' }).click();
  await page.getByRole('button', { name: 'Set test portfolio' }).click();

  await expect(page.getByTestId('probe-bridge-runtime')).toHaveText(
    'connected|false|EURUSD|1.0852|1.0852|1000.00|1745700001000',
  );
  await expect(page.getByTestId('probe-bridge-lifecycle-runtime')).toHaveText(
    'connected|false|EURUSD|1.0852|1000.00|1745700001000',
  );
});

test('lifecycle runtime follows status, market and account updates without quote subscription', async ({ page }) => {
  await mountHarness(page);
  const lifecycle = page.getByTestId('probe-bridge-lifecycle-runtime');

  await page.getByRole('button', { name: 'Set test bridge status' }).click();
  await expect(lifecycle).toHaveText('connected|true||||');
  expect((await probeCounts(page))['bridge-lifecycle-runtime']).toBeGreaterThan(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Set test account' }).click();
  await expect(lifecycle).toHaveText('connected|true|||1000.00|');
  expect((await probeCounts(page))['bridge-lifecycle-runtime']).toBeGreaterThan(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Load candle' }).click();
  await expect(lifecycle).toHaveText('connected|true|EURUSD|1.0850|1000.00|');
  expect((await probeCounts(page))['bridge-lifecycle-runtime']).toBeGreaterThan(0);
});

test('ticket edits and panel toggles update only their owning consumers', async ({ page }) => {
  await mountHarness(page);

  await page.getByRole('button', { name: 'Edit ticket' }).click();
  await expect(page.getByTestId('probe-ticket-edit')).toHaveText('1.2345');
  const ticketCounts = await probeCounts(page);
  expect(ticketCounts['ticket-edit']).toBeGreaterThan(0);
  expect(ticketCounts['ticket-extra-settings'] ?? 0).toBe(0);
  expect(ticketCounts['ticket-tick-value'] ?? 0).toBe(0);
  expect(ticketCounts.market ?? 0).toBe(0);
  expect(ticketCounts.account ?? 0).toBe(0);
  expect(ticketCounts.settings ?? 0).toBe(0);
  expect(ticketCounts.header ?? 0).toBe(0);
  expect(ticketCounts['chart-resources'] ?? 0).toBe(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Toggle panel' }).click();
  await expect(page.getByTestId('probe-panel')).toHaveText('true');
  const panelCounts = await probeCounts(page);
  expect(panelCounts.panel).toBeGreaterThan(0);
  expect(panelCounts.header).toBeGreaterThan(0);
  expect(panelCounts.settings ?? 0).toBe(0);
  expect(panelCounts.market ?? 0).toBe(0);
  expect(panelCounts['chart-resources'] ?? 0).toBe(0);
});

test('candle updates keep quote and unchanged chart-identity consumers idle', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Load candle' }).click();
  await expect(page.getByTestId('probe-candle-close')).toHaveText('1.0850');
  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Update candle' }).click();
  await expect(page.getByTestId('probe-candle-close')).toHaveText('1.0852');

  const counts = await probeCounts(page);
  expect(counts.market).toBeGreaterThan(0);
  expect(counts['chart-quotes'] ?? 0).toBe(0);
  expect(counts['chart-title'] ?? 0).toBe(0);
  expect(counts['chart-timeframes'] ?? 0).toBe(0);
  expect(counts['chart-canvas'] ?? 0).toBe(0);
});

test('irrelevant account fields stay out of ticket views while currency changes reach sizing', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Set test account' }).click();
  await expect(page.getByTestId('probe-account')).toHaveText('1000.00');
  await page.getByRole('button', { name: 'Use money sizing' }).click();
  const sizingMode = page.getByRole('button', { name: 'Sizing mode' });
  await expect(sizingMode).toContainText('Risk, USD');
  await resetProbeCounts(page);

  await page.getByRole('button', { name: 'Update balance' }).click();
  await expect(page.getByTestId('probe-account')).toHaveText('2000.00');
  const balanceCounts = await probeCounts(page);
  expect(balanceCounts.account).toBeGreaterThan(0);
  expect(balanceCounts['ticket-header'] ?? 0).toBe(0);
  expect(balanceCounts['ticket-sizing'] ?? 0).toBe(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Set EUR account' }).click();
  await expect(sizingMode).toContainText('Risk, EUR');
  const currencyCounts = await probeCounts(page);
  expect(currencyCounts['ticket-sizing']).toBeGreaterThan(0);
  expect(currencyCounts['ticket-header'] ?? 0).toBe(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Set real account' }).click();
  await expect(page.getByTestId('probe-ticket-header')).toContainText('REAL · 001234');
  const environmentCounts = await probeCounts(page);
  expect(environmentCounts['ticket-header']).toBeGreaterThan(0);
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

test('extra settings changes stay local to settings and preserve selection when collapsed', async ({ page }) => {
  await mountHarness(page);
  const extra = page.getByRole('button', { name: 'Extra settings' });
  await extra.click();
  await page.getByRole('combobox', { name: 'Time in force' }).selectOption('ioc');
  await expect(page.getByRole('combobox', { name: 'Time in force' })).toHaveValue('ioc');
  const counts = await probeCounts(page);
  expect(counts['ticket-extra-settings']).toBeGreaterThan(0);
  expect(counts['ticket-quotes'] ?? 0).toBe(0);
  expect(counts['ticket-edit'] ?? 0).toBe(0);
  await extra.click();
  await expect(page.getByRole('combobox', { name: 'Time in force' })).toHaveCount(0);
  await extra.click();
  await expect(page.getByRole('combobox', { name: 'Time in force' })).toHaveValue('ioc');
});

test('moving quotes keep unchanged sizing, exits and review action consumers idle', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Update quote' }).click();
  await expect(page.getByTestId('probe-market')).toHaveText('1.0852');
  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Move quote' }).click();
  await expect(page.getByTestId('probe-market')).toHaveText('1.08530');
  const counts = await probeCounts(page);
  expect(counts['ticket-quotes']).toBeGreaterThan(0);
  expect(counts['ticket-sizing'] ?? 0).toBe(0);
  expect(counts['ticket-tick-value'] ?? 0).toBe(0);
  expect(counts['ticket-exits'] ?? 0).toBe(0);
  expect(counts['ticket-action'] ?? 0).toBe(0);
});

test('ticket action updates only when its derived eligibility output changes', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Prepare action gate' }).click();
  await expect(page.getByTestId('probe-ticket-action')).toHaveText('true|false|buy');
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeEnabled();

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Change action entry' }).click();
  await page.getByRole('button', { name: 'Change action time in force' }).click();
  await expect(page.getByTestId('probe-ticket-action')).toHaveText('true|false|buy');
  expect((await probeCounts(page))['ticket-action'] ?? 0).toBe(0);

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Invalidate action volume' }).click();
  await expect(page.getByTestId('probe-ticket-action')).toHaveText('false|false|buy');
  await expect(page.getByRole('button', { name: 'Start creating order' })).toBeDisabled();
  expect((await probeCounts(page))['ticket-action']).toBeGreaterThan(0);
});

test('ticket action follows canonical gate inputs and all displayed action fields', async ({ page }) => {
  await mountHarness(page);
  await page.getByRole('button', { name: 'Prepare action gate' }).click();
  const action = page.getByTestId('probe-ticket-action');
  const review = page.getByRole('button', { name: 'Start creating order' });
  await expect(action).toHaveText('true|false|buy');
  await expect(review).toBeEnabled();

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Close action market' }).click();
  await expect(action).toHaveText('true|false|buy');
  await expect(review).toBeEnabled();
  expect((await probeCounts(page))['ticket-action'] ?? 0).toBe(0);

  await page.getByRole('button', { name: 'Remove action account' }).click();
  await expect(action).toHaveText('false|false|buy');
  await expect(review).toBeDisabled();
  expect((await probeCounts(page))['ticket-action']).toBeGreaterThan(0);

  await expectActionRerender(page, action, 'Disconnect action bridge', 'false|false|buy');

  await expectActionRerender(page, action, 'Change action side', 'true|false|sell');

  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Load action check' }).click();
  await expect(action).toHaveText('true|true|sell');
  expect((await probeCounts(page))['ticket-action']).toBeGreaterThan(0);
});

test('exits ignore draft-version changes without an RR label and keep enabled RR freshness', async ({ page }) => {
  await mountHarness(page);
  await expect(page.getByRole('button', { name: /Exits/ })).toHaveAttribute('aria-expanded', 'true');
  const rrLabel = page.locator('.ticket-risk-reward');
  await expect(rrLabel).toHaveCount(0);
  await resetProbeCounts(page);

  await page.getByRole('button', { name: 'Advance ticket version' }).click();
  await expect(rrLabel).toHaveCount(0);
  expect((await probeCounts(page))['ticket-exits'] ?? 0).toBe(0);

  await page.getByRole('button', { name: 'Prepare exit preview' }).click();
  await expect(rrLabel).toHaveText('RR 2.00');
  await resetProbeCounts(page);
  await page.getByRole('button', { name: 'Advance ticket version' }).click();
  await expect(rrLabel).toHaveText('RR 1.00');
  expect((await probeCounts(page))['ticket-exits']).toBeGreaterThan(0);
});

test('equity allocation scales percent risk but leaves explicit money risk unchanged', () => {
  for (const [allocation, budget] of [
    ['100', '100.00'],
    ['50', '50.00'],
    ['40', '40.00'],
    ['60', '60.00'],
  ]) {
    const basis = deriveOrderRiskBasis({
      unitsMode: 'equity',
      riskAmount: '1',
      equity: '10000',
      currency: 'USD',
      stagedOnChart: true,
      equityAllocationPercent: allocation,
    });
    expect(basis.effectiveRiskAmount).toBe(budget);
    expect(basis.riskModeHint).toBe(`≈ ${budget} USD`);
  }
  const money = deriveOrderRiskBasis({
    unitsMode: 'money',
    riskAmount: '100',
    equity: '10000',
    currency: 'USD',
    stagedOnChart: true,
    equityAllocationPercent: '50',
  });
  expect(money.effectiveRiskAmount).toBe('100');
  for (const allocation of ['', '0', '-1', '101']) {
    expect(
      deriveOrderRiskBasis({
        unitsMode: 'equity',
        riskAmount: '1',
        equity: '10000',
        currency: 'USD',
        stagedOnChart: true,
        equityAllocationPercent: allocation,
      }).effectiveRiskAmount,
    ).toBe('');
  }
});

test('equity risk rejects percentages outside the positive 0–100 range', () => {
  for (const riskAmount of ['0', '-1', '100.01', '200', 'Infinity', '']) {
    expect(
      deriveOrderRiskBasis({
        unitsMode: 'equity',
        riskAmount,
        equity: '5600',
        currency: 'USD',
        stagedOnChart: true,
      }).effectiveRiskAmount,
    ).toBe('');
  }
  expect(
    deriveOrderRiskBasis({
      unitsMode: 'equity',
      riskAmount: '100',
      equity: '5600',
      currency: 'USD',
      stagedOnChart: true,
    }).effectiveRiskAmount,
  ).toBe('5600.00');
});
