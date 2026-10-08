import { expect, test } from '@playwright/test';
import { gotoWithStub } from './tauriStub';

test('domain stores isolate updates and skip notifications for unchanged fields', async ({ page }) => {
  await gotoWithStub(page);
  await page.evaluate(async () => {
    const appRoot = document.getElementById('root');
    if (appRoot) {
      appRoot.style.display = 'none';
    }
    const harnessPath = '/e2e/domainStoreHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    harness.mountDomainStoreHarness();
  });

  await expect(page.getByTestId('first-counter')).toHaveText('0');
  await expect(page.getByTestId('second-counter')).toHaveText('10');
  await test.step('Sizing commands use current draft before rerender', async () => {
    await page.getByTestId('run-sizing-commands').click();
    await expect(page.getByTestId('sizing-command-result')).toHaveText('100:units:');
  });
  await page.getByTestId('first-counter').click();
  await expect(page.getByTestId('first-counter')).toHaveText('1');
  await expect(page.getByTestId('second-counter')).toHaveText('10');
  expect(
    await page.evaluate(
      () => (window as unknown as { __domainStoreNotifications: { first: number } }).__domainStoreNotifications.first,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __domainStoreSetterMetrics: { writerRenders: number } }).__domainStoreSetterMetrics
          .writerRenders,
    ),
  ).toBe(1);

  await page.getByTestId('rerender-writer').click();
  await expect(page.getByTestId('rerender-writer')).toHaveText('1');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __domainStoreSetterMetrics: { writerRenders: number; stableAcrossRenders: boolean } })
          .__domainStoreSetterMetrics,
    ),
  ).toEqual({ writerRenders: 2, stableAcrossRenders: true });

  await page.getByTestId('write-only-counter').click();
  await expect(page.getByTestId('first-counter')).toHaveText('2');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __domainStoreSetterMetrics: { writerRenders: number } }).__domainStoreSetterMetrics
          .writerRenders,
    ),
  ).toBe(2);

  await page.getByTestId('second-counter').click();
  await expect(page.getByTestId('second-counter')).toHaveText('11');
  await expect(page.getByTestId('first-counter')).toHaveText('2');
  expect(
    await page.evaluate(
      () => (window as unknown as { __domainStoreNotifications: { second: number } }).__domainStoreNotifications.second,
    ),
  ).toBe(1);
  await page.evaluate(async () => {
    const harnessPath = '/e2e/domainStoreHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    harness.unmountDomainStoreHarness();
  });
});
