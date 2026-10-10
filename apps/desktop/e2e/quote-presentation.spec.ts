import { expect, test } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

test('quote presentation preserves precision, malformed-value, and point-size fallbacks', async ({ page }) => {
  await gotoWithStub(page);
  const inputs = [
    { quote: undefined, pointSize: undefined },
    {
      quote: { bid: '1.08520', ask: '1.08536', last: '1.08529' },
      pointSize: '0.00001',
    },
    {
      quote: { bid: '1.2', ask: '1.3', last: '1.123456789' },
      pointSize: '0.01',
    },
    {
      quote: { bid: 'bad', ask: '1.2345', last: '1.2' },
      pointSize: '0.0001',
    },
    {
      quote: { bid: '1.08520', ask: '1.08536', last: '1.08529' },
      pointSize: undefined,
    },
    {
      quote: { bid: '1.08520', ask: '1.08536', last: '1.08529' },
      pointSize: '0',
    },
    {
      quote: { bid: '1.08520', ask: '1.08536', last: '1.08529' },
      pointSize: 'not-a-number',
    },
  ];

  const actual = await page.evaluate(async (cases) => {
    const formatPath = '/src/shared/format.ts';
    const { deriveQuotePresentation } = await import(/* @vite-ignore */ formatPath);
    return cases.map(({ quote, pointSize }) => deriveQuotePresentation(quote, pointSize));
  }, inputs);

  expect(actual).toEqual([
    { precision: 2, bidText: '—', askText: '—', spreadText: '—', spreadPoints: null },
    { precision: 5, bidText: '1.08520', askText: '1.08536', spreadText: '0.00016', spreadPoints: 16 },
    {
      precision: 8,
      bidText: '1.20000000',
      askText: '1.30000000',
      spreadText: '0.10000000',
      spreadPoints: 10,
    },
    { precision: 4, bidText: '—', askText: '1.2345', spreadText: '—', spreadPoints: null },
    { precision: 5, bidText: '1.08520', askText: '1.08536', spreadText: '0.00016', spreadPoints: null },
    { precision: 5, bidText: '1.08520', askText: '1.08536', spreadText: '0.00016', spreadPoints: null },
    { precision: 5, bidText: '1.08520', askText: '1.08536', spreadText: '0.00016', spreadPoints: null },
  ]);
});
