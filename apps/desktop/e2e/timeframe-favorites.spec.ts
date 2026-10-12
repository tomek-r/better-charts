import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';
import { answerSymbolSearch, openSymbolSearch } from './helpers/panel';
import { brokerSymbolFixture } from './helpers/tauriStub';
import { timeframeFavoritesKey } from '../src/features/chart/timeframes/timeframeFavorites';

const headerLabels = (page: Page) => page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button');
const chevron = (page: Page) => page.getByRole('button', { name: 'More timeframes' });
const menu = (page: Page) => page.getByRole('dialog', { name: 'Timeframes' });

/** Seeds storage once, so a later reload keeps whatever the app saved. */
async function seedStorage(page: Page, value: string) {
  await page.addInitScript(
    ([key, raw]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key, raw);
      }
    },
    [timeframeFavoritesKey, value],
  );
}

test('the header shows the default favorites in canonical order', async ({ page }) => {
  await gotoWithStub(page);
  await expect(headerLabels(page)).toHaveText(['1m', '5m', '15m', '1H', '4H', '1D', '1M']);
  await expect(chevron(page)).toHaveAttribute('aria-expanded', 'false');
});

test('starring and unstarring a timeframe updates the header at once and keeps the menu open', async ({ page }) => {
  await gotoWithStub(page);
  await chevron(page).click();
  await menu(page).getByRole('button', { name: 'Add 3m to favorites' }).click();
  await expect(menu(page)).toBeVisible();
  await expect(headerLabels(page)).toHaveText(['1m', '3m', '5m', '15m', '1H', '4H', '1D', '1M']);
  await menu(page).getByRole('button', { name: 'Remove 1m from favorites', exact: true }).click();
  await expect(headerLabels(page)).toHaveText(['3m', '5m', '15m', '1H', '4H', '1D', '1M']);
  await expect(menu(page).getByRole('button', { name: 'Add 1m to favorites', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

for (const width of [1280, 480]) {
  test(`the open menu stays where it opened when favorites change (${width}px wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await gotoWithStub(page);
    await chevron(page).click();
    const opened = (await menu(page).boundingBox())!;
    await menu(page).getByRole('button', { name: 'Add 3m to favorites' }).click();
    await expect(headerLabels(page)).toHaveText(['1m', '3m', '5m', '15m', '1H', '4H', '1D', '1M']);
    const afterStar = (await menu(page).boundingBox())!;
    expect(Math.abs(afterStar.x - opened.x)).toBeLessThan(0.5);
    expect(Math.abs(afterStar.y - opened.y)).toBeLessThan(0.5);
    await menu(page).getByRole('button', { name: 'Remove 1m from favorites', exact: true }).click();
    await expect(headerLabels(page)).toHaveText(['3m', '5m', '15m', '1H', '4H', '1D', '1M']);
    const afterUnstar = (await menu(page).boundingBox())!;
    expect(Math.abs(afterUnstar.x - opened.x)).toBeLessThan(0.5);
    expect(Math.abs(afterUnstar.y - opened.y)).toBeLessThan(0.5);
  });
}

test('favorites survive a reload', async ({ page }) => {
  await gotoWithStub(page);
  await chevron(page).click();
  await menu(page).getByRole('button', { name: 'Add 3m to favorites' }).click();
  await menu(page).getByRole('button', { name: 'Remove 1D from favorites' }).click();
  await page.reload();
  await expect(headerLabels(page)).toHaveText(['1m', '3m', '5m', '15m', '1H', '4H', '1M']);
});

test('invalid stored favorites fall back to the defaults', async ({ page }) => {
  await seedStorage(page, '{definitely not json');
  await gotoWithStub(page);
  await expect(headerLabels(page)).toHaveText(['1m', '5m', '15m', '1H', '4H', '1D', '1M']);
});

test('an empty favorites list leaves only the active timeframe and the chevron', async ({ page }) => {
  await seedStorage(page, '[]');
  await gotoWithStub(page);
  await expect(headerLabels(page)).toHaveText(['5m']);
  await expect(headerLabels(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(chevron(page)).toBeVisible();
});

test('the active timeframe stays in the header even when it is not a favorite', async ({ page }) => {
  await gotoWithStub(page);
  await chevron(page).click();
  await menu(page).getByRole('button', { name: '3 minutes', exact: true }).click();
  await expect(headerLabels(page)).toHaveText(['1m', '3m', '5m', '15m', '1H', '4H', '1D', '1M']);
  await expect(headerLabels(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await chevron(page).click();
  await expect(menu(page).getByRole('button', { name: '3 minutes', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await menu(page).getByRole('button', { name: '5 minutes', exact: true }).click();
  await expect(headerLabels(page)).toHaveText(['1m', '5m', '15m', '1H', '4H', '1D', '1M']);
});

test('Escape returns focus to the chevron and an outside press closes the menu', async ({ page }) => {
  await gotoWithStub(page);
  await chevron(page).click();
  await expect(chevron(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(chevron(page)).toBeFocused();
  await chevron(page).click();
  await page.locator('.chart-heading h1').click();
  await expect(menu(page)).toHaveCount(0);
  await chevron(page).click();
  await menu(page).click({ position: { x: 4, y: 4 } });
  await expect(menu(page)).toBeVisible();
});

test('the chevron points up while the menu is open and settles back when it closes', async ({ page }) => {
  await gotoWithStub(page);
  const caret = chevron(page).locator('svg');
  const transform = () => caret.evaluate((element) => getComputedStyle(element).transform);
  await expect.poll(transform).toBe('none');
  await chevron(page).click();
  await expect(menu(page)).toBeVisible();
  await expect.poll(transform).toMatch(/^matrix\(-1, /);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect.poll(transform).toBe('none');
});

test('sections collapse and expand', async ({ page }) => {
  await gotoWithStub(page);
  await chevron(page).click();
  const minutes = menu(page).getByRole('button', { name: 'Minutes', exact: true });
  await expect(menu(page).getByRole('button', { name: '1 minute', exact: true })).toBeVisible();
  await minutes.click();
  await expect(minutes).toHaveAttribute('aria-expanded', 'false');
  await expect(menu(page).getByRole('button', { name: '1 minute', exact: true })).toHaveCount(0);
  await expect(menu(page).getByRole('button', { name: '1 hour', exact: true })).toBeVisible();
  await minutes.click();
  await expect(menu(page).getByRole('button', { name: '1 minute', exact: true })).toBeVisible();
});

test('the menu overlays the chart without moving it and the chevron matches the label buttons', async ({ page }) => {
  await gotoWithStub(page);
  const canvas = page.locator('.chart-host');
  const before = await canvas.boundingBox();
  const chevronBox = (await chevron(page).boundingBox())!;
  const buttonBox = (await headerLabels(page).first().boundingBox())!;
  expect(chevronBox.height).toBe(buttonBox.height);
  const borderColor = () => chevron(page).evaluate((element) => getComputedStyle(element).borderTopColor);
  const restingBorder = await borderColor();
  expect(restingBorder).not.toBe('rgba(0, 0, 0, 0)');
  await chevron(page).hover();
  const hoverBorder = await borderColor();
  expect(hoverBorder).not.toBe('rgba(0, 0, 0, 0)');
  expect(hoverBorder).not.toBe(restingBorder);
  await chevron(page).click();
  await expect(menu(page)).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(before);
  const top = await menu(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + 10, rect.y + 10)?.closest('.timeframe-menu') !== null;
  });
  expect(top).toBe(true);
});

test('symbol search favorites still toggle with the shared star', async ({ page }) => {
  await gotoWithStub(page);
  const { dialog, input } = await openSymbolSearch(page);
  await answerSymbolSearch(page, input, 'NAS100', [brokerSymbolFixture('NAS100', 'US Tech 100')]);
  const star = dialog.getByRole('button', { name: 'Add NAS100 to favorites' });
  await star.click();
  await expect(dialog.getByRole('button', { name: 'Remove NAS100 from favorites' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    dialog.getByRole('button', { name: 'Remove NAS100 from favorites' }).locator('svg path'),
  ).toHaveAttribute('fill', 'currentColor');
});
