import { expect, test } from '@playwright/test';
import { brokerSymbolFixture, gotoWithStub, pushEvent } from './helpers/tauriStub';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { openTradePanel } from './helpers/panel';

// Units mode starts at the symbol's minimum volume instead of 1.
test('the Units field starts at the symbol minimum volume', async ({ page }) => {
  await gotoRiskBandStub(page); // volumeMin 0.1
  await openTradePanel(page);
  await expect(page.getByLabel('Units')).toHaveValue('0.1');
});

test('the fallback 1 is replaced once symbol metadata arrives, unless the user already typed a volume', async ({
  page,
}) => {
  await gotoWithStub(page);
  await openTradePanel(page);
  await expect(page.getByLabel('Units')).toHaveValue('1');
  const withMinimum = (volumeMin: string) =>
    brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', { volumeMin, volumeStep: '0.01', volumeMax: '100' });
  await pushEvent(page, 'symbol-info', withMinimum('0.01000000'));
  await expect(page.getByLabel('Units')).toHaveValue('0.01');
  await page.getByLabel('Units').fill('3');
  await pushEvent(page, 'symbol-info', withMinimum('0.10000000'));
  await page.waitForTimeout(200);
  await expect(page.getByLabel('Units')).toHaveValue('3');
});
