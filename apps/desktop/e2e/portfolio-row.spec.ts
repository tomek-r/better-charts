import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPortfolio, portfolioSnapshot } from './helpers/portfolioPage';
import { pushEvent, wasInvoked } from './helpers/tauriStub';

/** A `line-height: normal` line is about 1.2 font sizes tall; a wrapped value is at least two lines (~2.4). */
const MAX_SINGLE_LINE_FONT_SIZES = 1.8;
const POSITION_TOLERANCE_PX = 0.5;

async function expectSingleLine(line: Locator) {
  const { height, fontSize } = await line.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  }));
  expect(height).toBeLessThan(fontSize * MAX_SINGLE_LINE_FONT_SIZES);
}

/** The drawer slides in; resolves once the locator has stopped moving horizontally. */
async function waitUntilSettled(locator: Locator) {
  let previousX = Number.NaN;
  await expect
    .poll(async () => {
      const { x } = (await locator.boundingBox())!;
      const settled = x === previousX;
      previousX = x;
      return settled;
    })
    .toBe(true);
}

/** x and width of the header button and of every grid value cell. */
async function cellBoxes(page: Page) {
  const locators = [page.locator('.portfolio-open'), ...(await page.locator('.portfolio-figures dd').all())];
  return Promise.all(
    locators.map(async (locator) => {
      const { x, width } = (await locator.boundingBox())!;
      return { x, width };
    }),
  );
}

test('a position row shows a header and a label grid', async ({ page }) => {
  await openPortfolio(page);
  await expect(page.locator('.portfolio-open')).toHaveText(/^EURUSD\s*long\s*1(\.0+)? units$/);
  await expect(page.locator('.portfolio-side')).toHaveClass(/side-buy/);
  await expect(page.locator('.portfolio-figures dt')).toHaveText(['P/L', 'Price', 'SL', 'TP', 'Swap']);
  const values = page.locator('.portfolio-figures dd');
  await expect(values).toHaveText([/1\.20/, '1.0852', '1.0800', '1.0900', /0\.00/]);
  for (const value of await values.all()) {
    await expectSingleLine(value);
  }
});

test('a longer P/L moves and resizes nothing in the row', async ({ page }) => {
  await openPortfolio(page);
  await waitUntilSettled(page.locator('.portfolio-figures'));
  const before = await cellBoxes(page);
  await pushEvent(page, 'portfolio-snapshot', portfolioSnapshot([{ profit: '-123456.78' }]));
  await expect(page.locator('.portfolio-figures')).toContainText('123');
  const after = await cellBoxes(page);
  after.forEach((box, index) => {
    expect(Math.abs(box.x - before[index].x)).toBeLessThanOrEqual(POSITION_TOLERANCE_PX);
    expect(Math.abs(box.width - before[index].width)).toBeLessThanOrEqual(POSITION_TOLERANCE_PX);
  });
});

test('a click on the grid opens the symbol chart and Close stays clickable', async ({ page }) => {
  const { row, mainClose } = await openPortfolio(page, { symbol: 'GBPUSD' });
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  // The open button's stretched overlay covers the grid on purpose, so click the spot as a user would:
  // once the sliding drawer has stopped moving and the card is scrolled into view (a mouse click never scrolls).
  const figures = row.locator('.portfolio-figures');
  await waitUntilSettled(figures);
  await figures.scrollIntoViewIfNeeded();
  const grid = (await figures.boundingBox())!;
  await page.mouse.click(grid.x + 5, grid.y + 5);
  await expect(page.locator('.chart-heading h1')).toHaveText('GBPUSD');
  await mainClose.click();
  await expect.poll(async () => (await wasInvoked(page, 'close_position')) !== undefined).toBe(true);
});

test('the partial close input has the background of the order ticket inputs', async ({ page }) => {
  const { menuButton } = await openPortfolio(page);
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Custom volume…' }).click();
  const backgroundOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await backgroundOf(page.locator('.partial-volume-input'))).toBe(
    await backgroundOf(page.locator('.ticket-field').first()),
  );
});
