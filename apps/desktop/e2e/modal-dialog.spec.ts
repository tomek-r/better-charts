import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

/** Panel widths the size tokens in modal-dialog.css stand for. */
const COMPACT_WIDTH = 440;
const WIDE_SIZE = 860;

/** Loads the app page, mounts a harness from the helper module and returns its opener. */
async function mountHarness(page: Page, mount: 'mountModalDialogHarness' | 'mountScrollableModalHarness') {
  await gotoWithStub(page);
  await page.evaluate(async (name) => {
    const harnessPath = '/e2e/helpers/modalDialogHarness.tsx';
    const harness = await import(/* @vite-ignore */ harnessPath);
    harness[name]();
  }, mount);
  return page.getByTestId('open-modal');
}

test('the generic modal traps Tab and Shift+Tab, dismisses on Escape and restores focus', async ({ page }) => {
  const opener = await mountHarness(page, 'mountModalDialogHarness');
  await opener.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Generic modal' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  await expect(page.locator('[data-modal-dialog]')).toHaveCount(1);
  await expect(dialog).toHaveAttribute('data-size', 'compact');
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  expect(Math.round((await dialog.boundingBox())?.width ?? 0)).toBe(COMPACT_WIDTH);
  await expect(cancel).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the scrollable layout keeps header and footer fixed, shows the close button and footer note', async ({
  page,
}) => {
  const opener = await mountHarness(page, 'mountScrollableModalHarness');
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Scrollable modal' });
  const close = dialog.getByRole('button', { name: 'Close scrollable' });
  const submit = dialog.getByRole('button', { name: 'Submit' });
  await expect(close).toBeFocused();
  await expect(dialog.getByText('Footer note text')).toBeVisible();
  // The entrance animation scales the panel; a rounded size can match before it ends (slow CI
  // runners measured 99.99% scale), so wait for the animations themselves to finish.
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  // The wide size is 860 tall, capped by the viewport minus the backdrop padding.
  const viewportHeight = page.viewportSize()!.height;
  expect(Math.round((await dialog.boundingBox())?.height ?? 0)).toBe(Math.min(WIDE_SIZE, viewportHeight - 24));
  expect(Math.round((await dialog.boundingBox())?.width ?? 0)).toBe(WIDE_SIZE);

  const scroller = dialog.getByTestId('scroller');
  expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const before = [await close.boundingBox(), await submit.boundingBox()];
  await scroller.evaluate((element) => {
    element.scrollTop = 500;
  });
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect([await close.boundingBox(), await submit.boundingBox()]).toEqual(before);
  await expect(close).toBeInViewport();
  await expect(submit).toBeInViewport();

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keys typed inside the modal reach its own handlers while chart shortcuts stay blocked', async ({ page }) => {
  const opener = await mountHarness(page, 'mountScrollableModalHarness');
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Scrollable modal' });
  const input = dialog.getByLabel('Probe input');
  await input.click();
  await page.keyboard.type('ab');
  await expect(input).toHaveValue('ab');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search symbols' })).toBeHidden();
  await page.keyboard.press('Enter');

  const seen = await page.evaluate(() => {
    const recorder = window as unknown as { __modalKeys: string[]; __modalSubmits: number };
    return { keys: recorder.__modalKeys, submits: recorder.__modalSubmits };
  });
  expect(seen.keys).toEqual(['a', 'b', 'Control', 'k', 'Enter']);
  expect(seen.submits).toBe(1);
});
