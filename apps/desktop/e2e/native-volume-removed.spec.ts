import { expect, test } from '@playwright/test';

import { gotoWithStub } from './helpers/tauriStub';

const STUB_BAR_COUNT = 10;
const SURFACE_SERIES = ['Candlestick', 'Line'];

test('the chart surface owns no volume series', async ({ page }) => {
  await gotoWithStub(page);
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(STUB_BAR_COUNT);

  const seriesTypes = await page.evaluate(() => window.__chartTest?.priceSeriesTypes() ?? []);

  expect(seriesTypes).not.toContain('Histogram');
  expect(seriesTypes).toEqual(SURFACE_SERIES);
});
