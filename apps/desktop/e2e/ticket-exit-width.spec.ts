import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTradePanel } from './helpers/panel';
import { brokerSymbolFixture, eurusdQuote, gotoWithStub, pushEvent, STUB_NOW } from './helpers/tauriStub';

const instrument = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', {
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
});

async function width(locator: Locator): Promise<number> {
  return (await locator.boundingBox())!.width;
}

/** Digit-heavy prices of different glyph widths, so a proportional readout would change width. */
const QUOTES: Array<[string, string]> = [
  ['1.11111', '1.11113'],
  ['1.00008', '1.00010'],
  ['1.08888', '1.08890'],
];

async function pushQuoteAndWaitForReadout(page: Page, readout: Locator, index: number) {
  const before = await readout.textContent();
  const [bid, ask] = QUOTES[index];
  await pushEvent(page, 'quote-update', eurusdQuote(STUB_NOW + (index + 1) * 1000, bid, ask));
  await expect.poll(async () => await readout.textContent()).not.toBe(before);
}

test('the exit row keeps its input and readout widths while the live price changes digits', async ({
  page,
}, testInfo) => {
  await gotoWithStub(page, { symbolInfo: instrument });
  await openTradePanel(page);
  await page.locator('section.order-ticket .ticket-quote-side.buy').click();
  await page.getByLabel('Stop loss enabled').check();
  const row = page.locator('.ticket-exit').filter({ hasText: 'Stop loss' });
  const input = row.getByLabel('Stop loss ticks');
  const readout = row.locator('.ticket-unit');
  await input.fill('100');
  await expect(readout).toContainText('price');
  await pushQuoteAndWaitForReadout(page, readout, 0);
  const inputWidth = await width(input);
  const readoutWidth = await width(readout);
  await row.screenshot({ path: testInfo.outputPath('exit-row.png') });
  for (const index of [1, 2]) {
    await pushQuoteAndWaitForReadout(page, readout, index);
    expect(await width(input)).toBe(inputWidth);
    expect(await width(readout)).toBe(readoutWidth);
  }
});
