import { expect, test } from '@playwright/test';
import { openPortfolio } from './helpers/portfolioPage';

test('the positions heading counts one position in the singular', async ({ page }) => {
  await openPortfolio(page);
  await expect(page.locator('.portfolio-heading span')).toHaveText('1 position');
});

test('the positions heading counts several positions in the plural', async ({ page }) => {
  await openPortfolio(page, {}, { morePositions: [{ positionId: '885002' }] });
  await expect(page.locator('.portfolio-heading span')).toHaveText('2 positions');
});
