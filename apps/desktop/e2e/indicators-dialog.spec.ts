import { expect, test } from '@playwright/test';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { matchingIndicators } from '../src/features/indicators/indicatorSearch';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import {
  attachedDefinitions,
  attachedIndicators,
  indicatorsButton,
  indicatorsDialog,
  indicatorsList,
  listRows,
  openIndicators,
} from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { openChart } from './helpers/openChart';
import { gotoWithStub } from './helpers/tauriStub';

const NO_MATCHES = 'No indicators found.';
const SMA_TITLE = 'Moving Average Simple';
/** Every key an attached SMA resolves with: its inputs, its styles and the display switches. */
const SMA_SETTING_COUNT = Object.keys(resolveSettingValues(indicatorSettingsSchema(smaPlugin), {})).length;

const ROW_FONT_SIZE = '14px';

test.describe('indicators dialog', () => {
  failOnPageNoise();

  test.beforeEach(async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
  });

  test('the dialog sits near the top of the window, not in its centre', async ({ page }) => {
    await openIndicators(page);

    const box = await indicatorsDialog(page).boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) {
      throw new Error('the dialog or the viewport has no bounding box');
    }

    // A centred dialog has its middle on the window's middle; one anchored to the top sits above it.
    expect(box.y + box.height / 2).toBeLessThan(viewport.height / 2);
  });

  test('indicator names are written at 14px', async ({ page }) => {
    await openIndicators(page);

    await expect(listRows(page).first()).toHaveCSS('font-size', ROW_FONT_SIZE);
  });

  test('the Indicators button opens a dialog with the search field focused and every indicator listed', async ({
    page,
  }) => {
    const search = await openIndicators(page);

    await expect(indicatorsButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toBeFocused();
    await expect(indicatorsList(page).getByText(SMA_TITLE)).toBeVisible();
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
    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
    const attached = await attachedIndicators(page);
    expect(attached[0]?.definitionId).toBe('sma');
    expect(attached[0]?.settings).toHaveLength(SMA_SETTING_COUNT);
  });

  test('Enter attaches the first match', async ({ page }) => {
    const search = await openIndicators(page);

    await search.fill('sma');
    await search.press('Enter');

    await expect(indicatorsDialog(page)).toBeHidden();
    await expect.poll(() => attachedDefinitions(page)).toEqual(['sma']);
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
