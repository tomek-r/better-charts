import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { matchingIndicators } from '../src/features/indicators/indicatorSearch';
import { openChart } from './helpers/openChart';
import { pageNoise, recordPageNoise } from './helpers/pageNoise';
import { gotoWithStub } from './helpers/tauriStub';

const DIALOG_NAME = 'Indicators';
const BUTTON_NAME = 'Indicators';
const SEARCH_NAME = 'Search indicators';
const LIST_NAME = 'Indicators';
const NO_MATCHES = 'No indicators found.';
const SMA_TITLE = 'Moving Average Simple';
const SMA_SETTING_COUNT = 9;

type AttachedIndicator = {
  instanceId: string;
  definitionId: string;
  settings: unknown;
};

function indicatorsButton(page: Page) {
  return page.getByRole('button', { name: BUTTON_NAME, exact: true });
}

function indicatorsDialog(page: Page) {
  return page.getByRole('dialog', { name: DIALOG_NAME });
}

function searchField(page: Page) {
  return page.getByRole('searchbox', { name: SEARCH_NAME });
}

function listRows(page: Page) {
  return indicatorsDialog(page).getByRole('list', { name: LIST_NAME }).getByRole('button');
}

async function openIndicators(page: Page) {
  await indicatorsButton(page).click();
  await expect(indicatorsDialog(page)).toBeVisible();
  return searchField(page);
}

async function attachedIndicators(page: Page): Promise<AttachedIndicator[]> {
  const attached = await page.evaluate(() => window.__chartTest!.attachedIndicators());
  return Array.from(attached);
}

async function attachedDefinitions(page: Page): Promise<string[]> {
  const attached = await attachedIndicators(page);
  return attached.map((indicator) => indicator.definitionId);
}

test.describe('indicators dialog', () => {
  test.beforeEach(async ({ page }) => {
    await recordPageNoise(page);
    await gotoWithStub(page);
    await openChart(page);
  });

  test.afterEach(async ({ page }) => {
    expect(await pageNoise(page)).toEqual([]);
  });

  test('the Indicators button opens a dialog with the search field focused and every indicator listed', async ({
    page,
  }) => {
    const search = await openIndicators(page);

    await expect(indicatorsButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toBeFocused();
    await expect(indicatorsDialog(page).getByRole('list', { name: LIST_NAME }).getByText(SMA_TITLE)).toBeVisible();
  });

  test('typing filters the list by name or short name', async ({ page }) => {
    const search = await openIndicators(page);

    await search.fill('mov');
    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toHaveText(SMA_TITLE);

    await search.fill('sma');
    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toHaveText(SMA_TITLE);

    await search.fill('zzz');
    await expect(listRows(page)).toHaveCount(0);
    await expect(indicatorsDialog(page).getByRole('status')).toHaveText(NO_MATCHES);
  });

  test('choosing an indicator attaches it and closes the dialog', async ({ page }) => {
    await openIndicators(page);

    await listRows(page).first().click();

    await expect(indicatorsDialog(page)).toBeHidden();
    const attached = await attachedIndicators(page);
    expect(attached).toHaveLength(1);
    expect(attached[0]?.definitionId).toBe('sma');
    expect(attached[0]?.settings).toHaveLength(SMA_SETTING_COUNT);
  });

  test('Enter attaches the first match', async ({ page }) => {
    const search = await openIndicators(page);

    await search.fill('sma');
    await search.press('Enter');

    await expect(indicatorsDialog(page)).toBeHidden();
    expect(await attachedDefinitions(page)).toEqual(['sma']);
  });

  test('Escape and the close button close the dialog without attaching anything', async ({ page }) => {
    await openIndicators(page);

    await page.keyboard.press('Escape');
    await expect(indicatorsDialog(page)).toBeHidden();
    await expect(indicatorsButton(page)).toBeFocused();

    await openIndicators(page);
    await page.getByRole('button', { name: 'Close indicators' }).click();
    await expect(indicatorsDialog(page)).toBeHidden();

    expect(await attachedDefinitions(page)).toEqual([]);
  });
});

test('matchingIndicators keeps registry order and ignores case and surrounding spaces', () => {
  const simpleAverage = { title: 'Moving Average Simple', shortTitle: 'SMA' };
  const strengthIndex = { title: 'Relative Strength Index', shortTitle: 'RSI' };
  const momentum = { title: 'Simple Momentum', shortTitle: 'SM' };
  const fixtures = [simpleAverage, strengthIndex, momentum];

  expect(matchingIndicators(fixtures, '')).toEqual(fixtures);
  expect(matchingIndicators(fixtures, '  SIMPLE  ')).toEqual([simpleAverage, momentum]);
  expect(matchingIndicators(fixtures, 'rsi')).toEqual([strengthIndex]);
});
