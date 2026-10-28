import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPortfolio, portfolioSnapshot } from './helpers/portfolioPage';
import { pushEvent } from './helpers/tauriStub';

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

async function columnBoxes(page: Page) {
  const position = (await page.locator('.portfolio-position').boundingBox())!;
  const figures = (await page.locator('.portfolio-figures').boundingBox())!;
  return { position, figures };
}

test('each position detail sits on its own line', async ({ page }) => {
  await openPortfolio(page);
  const positionLines = page.locator('.portfolio-position > *');
  const figureLines = page.locator('.portfolio-figures > *');
  await expect(positionLines).toHaveText(['EURUSD', 'Position', 'buy', /^1(\.0+)? units$/]);
  await expect(figureLines).toHaveText(['1.0852', /^P\/L /, /^Swap /, /^SL 1\.0800/]);
  for (const line of [...(await positionLines.all()), ...(await figureLines.all())]) {
    await expectSingleLine(line);
  }
});

test('a longer P/L moves and resizes neither column', async ({ page }) => {
  await openPortfolio(page);
  await waitUntilSettled(page.locator('.portfolio-figures'));
  const before = await columnBoxes(page);
  await pushEvent(page, 'portfolio-snapshot', portfolioSnapshot([{ profit: '-123456.78' }]));
  await expect(page.locator('.portfolio-figures')).toContainText('123');
  const after = await columnBoxes(page);
  for (const column of ['position', 'figures'] as const) {
    expect(Math.abs(after[column].x - before[column].x)).toBeLessThanOrEqual(POSITION_TOLERANCE_PX);
    expect(Math.abs(after[column].width - before[column].width)).toBeLessThanOrEqual(POSITION_TOLERANCE_PX);
  }
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
