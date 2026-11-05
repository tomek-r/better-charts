import { expect, test, type Page } from '@playwright/test';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';
import { attachSma, attachedDefinitions, attachedIndicators } from './helpers/indicatorsDialog';
import { openChart } from './helpers/openChart';
import { failOnPageNoise } from './helpers/pageNoise';
import { latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import { gotoWithStub } from './helpers/tauriStub';

/** Number of indicator lines the chart has actually drawn. */
function drawnLineCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__chartTest!.indicators().length);
}

test.describe('saved indicators', () => {
  failOnPageNoise();

  test("an attached indicator is saved with the chart's settings", async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
    await attachSma(page);

    await expect.poll(async () => readSavedIndicators(await latestSavedIndicators(page))?.length).toBe(1);
    const saved = readSavedIndicators(await latestSavedIndicators(page));
    const entry = saved?.[0];
    expect(entry).toMatchObject({ definitionId: 'sma', settings: {} });
    expect(typeof entry?.instanceId).toBe('string');
    expect(entry?.instanceId.length).toBeGreaterThan(0);
  });

  test('a saved indicator is attached again when the chart opens', async ({ page }) => {
    await openWithSavedIndicators(page, [{ instanceId: 'saved-1', definitionId: 'sma', settings: { length: 3 } }]);

    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
    expect((await attachedIndicators(page))[0]).toMatchObject({
      instanceId: 'saved-1',
      definitionId: 'sma',
      settings: { length: 3 },
    });
    expect(await drawnLineCount(page)).toBe(1);
  });

  test('an indicator attached before a reload is attached again after it', async ({ page }) => {
    await gotoWithStub(page);
    await openChart(page);
    await attachSma(page);
    await expect.poll(() => attachedDefinitions(page)).toEqual(['sma']);

    await page.reload();
    await openChart(page);

    await expect.poll(() => attachedDefinitions(page)).toEqual(['sma']);
  });

  test('a malformed saved entry is dropped and the valid ones attach', async ({ page }) => {
    await openWithSavedIndicators(page, [
      { instanceId: '', definitionId: 'sma' },
      42,
      { instanceId: 'ok', definitionId: 'sma', settings: { length: 'x', source: 'hl2' } },
    ]);

    await expect.poll(async () => (await attachedIndicators(page)).length).toBe(1);
    expect((await attachedIndicators(page))[0]).toMatchObject({
      instanceId: 'ok',
      settings: { length: 9, source: 'hl2' },
    });
  });

  test('an indicator this build does not know stays saved and draws nothing', async ({ page }) => {
    await openWithSavedIndicators(page, [{ instanceId: 'later', definitionId: 'not-yet', settings: {} }]);

    await expect.poll(() => attachedIndicators(page)).toEqual([]);
    await expect.poll(() => drawnLineCount(page)).toBe(0);

    await attachSma(page);

    await expect.poll(async () => readSavedIndicators(await latestSavedIndicators(page))?.length).toBe(2);
    const saved = readSavedIndicators(await latestSavedIndicators(page)) ?? [];
    expect(saved[0]).toEqual({ instanceId: 'later', definitionId: 'not-yet', settings: {} });
    expect(saved[1]?.definitionId).toBe('sma');
  });
});

test('readSavedIndicators keeps well-formed entries, the first of a repeated id, and only plain values', () => {
  expect(readSavedIndicators({})).toBeUndefined();

  expect(
    readSavedIndicators([
      {
        instanceId: 'a',
        definitionId: 'sma',
        settings: { length: 3, flag: true, nested: {}, nan: Number.NaN },
      },
      { instanceId: 'a', definitionId: 'other' },
      { instanceId: 'b', definitionId: 'sma' },
    ]),
  ).toEqual([
    { instanceId: 'a', definitionId: 'sma', settings: { length: 3, flag: true } },
    { instanceId: 'b', definitionId: 'sma', settings: {} },
  ]);
});
