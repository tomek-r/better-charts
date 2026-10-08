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
  await page.getByTestId('first-counter').click();
  await expect(page.getByTestId('first-counter')).toHaveText('1');
  await expect(page.getByTestId('second-counter')).toHaveText('10');
  expect(
    await page.evaluate(
      () => (window as unknown as { __domainStoreNotifications: { first: number } }).__domainStoreNotifications.first,
    ),
  ).toBe(1);

  await page.getByTestId('second-counter').click();
  await expect(page.getByTestId('second-counter')).toHaveText('11');
  await expect(page.getByTestId('first-counter')).toHaveText('1');
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
