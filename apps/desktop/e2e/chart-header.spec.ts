import { expect, test } from '@playwright/test';
import { answerSymbolSearch, chooseSearchResult, openSymbolSearch } from './helpers/panel';
import { brokerSymbolFixture, gotoWithStub, pushEvent } from './helpers/tauriStub';

test('timeframe buttons have equal widths and selection preserves their layout', async ({ page }) => {
  await gotoWithStub(page);
  // Larger system text must not let the longer labels resize their buttons.
  await page.addStyleTag({ content: '.timeframe-tabs button { font-size: 14px; }' });
  const tabs = page.getByRole('group', { name: 'Chart timeframe' });
  const buttons = tabs.getByRole('button');
  const bounds = () =>
    buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  await expect(tabs.getByRole('button', { name: '30m', exact: true })).toBeEnabled();
  const initial = await bounds();
  expect(new Set(initial.map((button) => button.width)).size).toBe(1);
  for (const label of ['30m', '1m']) {
    await tabs.getByRole('button', { name: label, exact: true }).click();
    await expect(tabs.locator('[aria-pressed="true"]')).toHaveText(label);
    expect(await bounds()).toEqual(initial);
  }
});

test('chart title shows current broker description and updates it without changing the symbol', async ({ page }) => {
  await gotoWithStub(page);
  const title = page.locator('.chart-heading h1');
  const description = page.locator('.chart-symbol-description');
  await expect(title).toHaveText('EURUSD');
  await expect(description).toHaveCount(0);

  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', 'Euro vs US Dollar'));
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

  await pushEvent(page, 'symbol-info', brokerSymbolFixture('GBPUSD', 'Pound vs US Dollar'));
  await expect(description).toHaveText('Euro vs US Dollar');
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', 'Euro / US Dollar'));
  await expect(description).toHaveText('Euro / US Dollar');
  await expect(title).toHaveText('EURUSD');
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', ''));
  await expect(description).toHaveCount(0);
});

test('symbol selection hides the previous description while loading and shows the accepted symbol description', async ({
  page,
}) => {
  await gotoWithStub(page, { historyDelayMs: 900 });
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', 'Euro vs US Dollar'));
  await expect(page.locator('.chart-symbol-description')).toHaveText('Euro vs US Dollar');

  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'US Tech 100')]);
  await chooseSearchResult(dialog, 'NAS100');
  await expect(page.locator('.chart-heading h1')).toHaveText('Loading symbol…');
  await expect(page.locator('.chart-symbol-description')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button').first()).toBeDisabled();
  await expect(page.locator('.chart-heading h1')).toHaveText('NAS100');
  await expect(page.locator('.chart-symbol-description')).toHaveText('US Tech 100');
  await expect(page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button').first()).toBeEnabled();
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', 'Stale Euro description'));
  await expect(page.locator('.chart-symbol-description')).toHaveText('US Tech 100');
});
