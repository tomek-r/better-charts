import { expect, test, type Page } from '@playwright/test';
import type { BrokerSymbol } from '../src/shared/bridge/types';
import { formatVolume } from '../src/shared/format';
import { brokerSymbolFixture, gotoWithStub, pushEvent } from './helpers/tauriStub';
import { gotoRiskBandStub } from './helpers/riskBandStub';
import { openTradePanel } from './helpers/panel';

// Units mode starts at the symbol's minimum volume instead of 1.
test('the Units field starts at the symbol minimum volume', async ({ page }) => {
  await gotoRiskBandStub(page); // volumeMin 0.1
  await openTradePanel(page);
  await expect(page.getByLabel('Units')).toHaveValue('0.1');
});

async function openUnitsWithSymbolLimits(page: Page, limits: Partial<BrokerSymbol>) {
  await gotoWithStub(page);
  await openTradePanel(page);
  await pushEvent(page, 'symbol-info', brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', limits));
  const units = page.getByLabel('Units');
  await expect(units).toHaveValue(formatVolume(limits.volumeMin ?? '1'));
  await units.focus();
  return units;
}

test('the Units arrows step by a 0.1 minimum volume without float noise and stay inside the limits', async ({
  page,
}) => {
  const units = await openUnitsWithSymbolLimits(page, { volumeMin: '0.1', volumeStep: '0.1', volumeMax: '1000' });
  await page.keyboard.press('ArrowUp');
  await expect(units).toHaveValue('0.2');
  await page.keyboard.press('ArrowUp');
  await expect(units).toHaveValue('0.3');
  await page.keyboard.press('ArrowDown');
  await expect(units).toHaveValue('0.2');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(units).toHaveValue('0.1');
  await units.fill('999.9');
  await page.keyboard.press('ArrowUp');
  await expect(units).toHaveValue('1000');
  await page.keyboard.press('ArrowUp');
  await expect(units).toHaveValue('1000');
});

test('the Units arrows step by a 0.01 minimum volume', async ({ page }) => {
  const units = await openUnitsWithSymbolLimits(page, { volumeMin: '0.01', volumeStep: '0.01', volumeMax: '100' });
  await page.keyboard.press('ArrowUp');
  await expect(units).toHaveValue('0.02');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(units).toHaveValue('0.01');
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
