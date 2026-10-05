import { expect, test } from '@playwright/test';
import type { BrokerSymbol } from '../src/shared/bridge/types';
import { gotoWithStub, pushEvent, stubInvocations } from './tauriStub';

const brokerSymbol = (symbol: string, description: string): BrokerSymbol => ({
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

test('chart title shows current broker description and updates it without changing the symbol', async ({ page }) => {
  await gotoWithStub(page);
  const title = page.locator('.chart-heading h1');
  const description = page.locator('.chart-symbol-description');
  await expect(title).toHaveText('EURUSD');
  await expect(description).toHaveCount(0);

  await pushEvent(page, 'symbol-info', brokerSymbol('EURUSD', 'Euro vs US Dollar'));
  await expect(description).toHaveText('Euro vs US Dollar');
  const titleBounds = await title.boundingBox();
  const descriptionBounds = await description.boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(descriptionBounds).not.toBeNull();
  expect(descriptionBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width);
  const styles = await description.evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    titleFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.chart-heading h1')!).fontSize),
    color: getComputedStyle(element).color,
    paletteColor: getComputedStyle(document.documentElement).getPropertyValue('--color-muted-strong').trim(),
  }));
  expect(styles.fontSize).toBeLessThan(styles.titleFontSize);
  expect(styles.paletteColor).toBe('#8b99ad');
  expect(styles.color).toBe('rgb(139, 153, 173)');

  await pushEvent(page, 'symbol-info', brokerSymbol('GBPUSD', 'Pound vs US Dollar'));
  await expect(description).toHaveText('Euro vs US Dollar');
  await pushEvent(page, 'symbol-info', brokerSymbol('EURUSD', 'Euro / US Dollar'));
  await expect(description).toHaveText('Euro / US Dollar');
  await expect(title).toHaveText('EURUSD');
  await pushEvent(page, 'symbol-info', brokerSymbol('EURUSD', ''));
  await expect(description).toHaveCount(0);
});

test('symbol selection hides the previous description while loading and shows the accepted symbol description', async ({
  page,
}) => {
  await gotoWithStub(page, { historyDelayMs: 900 });
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await pushEvent(page, 'symbol-info', brokerSymbol('EURUSD', 'Euro vs US Dollar'));
  await expect(page.locator('.chart-symbol-description')).toHaveText('Euro vs US Dollar');

  await page.getByRole('button', { name: 'Search symbols' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search symbols' });
  await dialog.getByPlaceholder('Search symbol — e.g. NAS100').fill('NAS100');
  await expect
    .poll(async () => (await stubInvocations(page)).filter((entry) => entry.cmd === 'search_symbols'))
    .toHaveLength(1);
  await pushEvent(page, 'symbol-search-result', {
    query: 'NAS100',
    source: 'live',
    symbols: [brokerSymbol('NAS100', 'US Tech 100')],
  });
  await dialog.locator('.search-result-row').filter({ hasText: 'NAS100' }).getByRole('button').first().click();
  await expect(page.locator('.chart-heading h1')).toHaveText('Loading symbol…');
  await expect(page.locator('.chart-symbol-description')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button').first()).toBeDisabled();
  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100');
  await expect(page.locator('.chart-symbol-description')).toHaveText('US Tech 100');
  await expect(page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button').first()).toBeEnabled();
  await pushEvent(page, 'symbol-info', brokerSymbol('EURUSD', 'Stale Euro description'));
  await expect(page.locator('.chart-symbol-description')).toHaveText('US Tech 100');
});
