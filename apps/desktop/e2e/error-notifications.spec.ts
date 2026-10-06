import { expect, test } from '@playwright/test';
import { gotoWithStub, pushCommandError, pushEvent } from './tauriStub';

test('bridge errors appear at bottom right and remain dismissible after recovery', async ({ page }) => {
  const errors = await gotoWithStub(page);
  await pushEvent(page, 'bridge-status', { state: 'protocol_error', message: 'invalid account snapshot' });
  const notice = page.locator('.notification-region [role=alert]').filter({ hasText: 'invalid account snapshot' });
  await expect(notice).toBeVisible();
  const bounds = await notice.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x + bounds!.width).toBeGreaterThan(viewport.width - 30);
  expect(bounds!.y + bounds!.height).toBeGreaterThan(viewport.height - 30);
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'Bridge connected.' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss error notification' }).click();
  await expect(notice).toBeHidden();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('duplicate errors share one notification and the stack stays bounded', async ({ page }) => {
  const errors = await gotoWithStub(page);
  for (let i = 0; i < 3; i++) {
    await pushCommandError(page, { code: 'test_error', message: 'Repeated broker error.' });
  }
  const notices = page.locator('.notification-region [role=alert]');
  await expect(notices.filter({ hasText: 'Repeated broker error.' })).toHaveCount(1);
  for (let i = 0; i < 6; i++) {
    await pushCommandError(page, { code: 'test_error', message: `Broker error ${i}.` });
  }
  await expect(notices).toHaveCount(5);
  await expect(notices.filter({ hasText: 'Broker error 5.' })).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});
