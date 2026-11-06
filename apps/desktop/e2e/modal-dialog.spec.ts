import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragBy } from './helpers/dragPanel';
import { gotoWithStub } from './helpers/tauriStub';

/** Panel widths the size tokens in modal-dialog.css stand for. */
const COMPACT_WIDTH = 440;
const WIDE_SIZE = 860;
/** A point 10 px in from the viewport's top-left corner: on the backdrop, clear of any panel. */
const BACKDROP_POINT = 10;
/** The full-window backdrop of the mounted modal, which carries `is-closing` while its exit animation plays. */
const BACKDROP_SELECTOR = '.modal-dialog-backdrop';
/** The header that drags a panel. */
const HEADER_SELECTOR = '.modal-dialog-header';
/** How far the drag tests move a panel: far enough to be unmistakable, well inside the drag's limits. */
const DRAG_RIGHT = 120;
const DRAG_DOWN = 60;
/** A drag past every window edge, to check where the clamp stops the panel. */
const DRAG_OUT_OF_REACH = 5000;
/** A drag right the default window allows, which a window narrowed well below it has to pull back. */
const DRAG_BEYOND_NARROWING = 300;
/** A window narrow enough that this drag would stand the panel's left edge past `MIN_PANEL_VISIBLE_PX`. */
const NARROW_VIEWPORT_WIDTH = 320;
/** The least of a panel's width a drag leaves inside the viewport (see useDraggablePanel). */
const MIN_PANEL_VISIBLE_PX = 48;

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

/** Opens the harness's two-action modal and returns its dialog. */
async function openGenericModal(page: Page): Promise<Locator> {
  const opener = await mountHarness(page, 'mountModalDialogHarness');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Generic modal' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Closes the modal with `dismiss` and asserts the backdrop runs the exit animation before the dialog goes. */
async function expectExitBeforeGone(page: Page, dialog: Locator, dismiss: () => Promise<void>): Promise<void> {
  await dismiss();
  await expect(page.locator(BACKDROP_SELECTOR)).toHaveClass(/is-closing/);
  await expect(dialog).toBeHidden();
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

test('Escape plays the exit animation before the modal goes', async ({ page }) => {
  const dialog = await openGenericModal(page);

  await expectExitBeforeGone(page, dialog, () => page.keyboard.press('Escape'));
});

test('a click on the backdrop plays the exit animation before the modal goes', async ({ page }) => {
  const dialog = await openGenericModal(page);

  await expectExitBeforeGone(page, dialog, () => page.mouse.click(BACKDROP_POINT, BACKDROP_POINT));
});

test('a press that starts in the panel and ends on the backdrop keeps the modal', async ({ page }) => {
  const dialog = await openGenericModal(page);
  const panel = await dialog.boundingBox();
  if (panel === null) {
    throw new Error('The modal panel is not laid out.');
  }

  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2);
  await page.mouse.down();
  await page.mouse.move(BACKDROP_POINT, BACKDROP_POINT);
  await page.mouse.up();

  await expect(dialog).toBeVisible();
});

test('a click inside the panel keeps the modal', async ({ page }) => {
  const dialog = await openGenericModal(page);

  await dialog.getByRole('heading').click();

  await expect(dialog).toBeVisible();
});

test('dragging the header moves the panel by the drag and keeps the modal open', async ({ page }) => {
  // No entry animation scaling the panel, so the box the two reads compare is the panel's own.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openGenericModal(page);
  const before = await dialog.boundingBox();

  await dragBy(page, dialog.locator(HEADER_SELECTOR), DRAG_RIGHT, DRAG_DOWN);

  const after = await dialog.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x + DRAG_RIGHT, 0);
  expect(after!.y).toBeCloseTo(before!.y + DRAG_DOWN, 0);
  await expect(dialog).toBeVisible();
});

test('a second drag moves the panel on from where the first one left it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openGenericModal(page);
  const before = await dialog.boundingBox();
  const header = dialog.locator(HEADER_SELECTOR);

  await dragBy(page, header, DRAG_RIGHT, DRAG_DOWN);
  await dragBy(page, header, DRAG_RIGHT, DRAG_DOWN);

  const after = await dialog.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x + 2 * DRAG_RIGHT, 0);
  expect(after!.y).toBeCloseTo(before!.y + 2 * DRAG_DOWN, 0);
});

test('a reopened modal starts where the modal puts it: the dragged position is not saved', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openGenericModal(page);
  const undragged = await dialog.boundingBox();

  await dragBy(page, dialog.locator(HEADER_SELECTOR), DRAG_RIGHT, DRAG_DOWN);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByTestId('open-modal').click();
  await expect(dialog).toBeVisible();

  const reopened = await dialog.boundingBox();
  expect(reopened!.x).toBeCloseTo(undragged!.x, 0);
  expect(reopened!.y).toBeCloseTo(undragged!.y, 0);
});

test("a press on the header's close button stays the button's: the panel does not move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const opener = await mountHarness(page, 'mountScrollableModalHarness');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Scrollable modal' });
  const before = await dialog.boundingBox();

  await dragBy(page, dialog.getByRole('button', { name: 'Close scrollable' }), DRAG_RIGHT, DRAG_DOWN);

  const after = await dialog.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await expect(dialog).toBeVisible();
});

test('a drag past the window edges keeps the panel in reach', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openGenericModal(page);

  await dragBy(page, dialog.locator(HEADER_SELECTOR), -DRAG_OUT_OF_REACH, -DRAG_OUT_OF_REACH);

  const box = await dialog.boundingBox();
  if (box === null) {
    throw new Error('The modal panel is not laid out.');
  }
  // The top edge stops at the window's top, and at least MIN_PANEL_VISIBLE_PX of the panel stays inside it.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeGreaterThanOrEqual(MIN_PANEL_VISIBLE_PX);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('a window that narrows pulls a dragged panel back into reach', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openGenericModal(page);
  await dragBy(page, dialog.locator(HEADER_SELECTOR), DRAG_BEYOND_NARROWING, 0);

  const height = page.viewportSize()!.height;
  await page.setViewportSize({ width: NARROW_VIEWPORT_WIDTH, height });

  // The narrowed window leaves less room than the drag used, so the clamp pulls the panel back in.
  await expect
    .poll(async () => (await dialog.boundingBox())!.x)
    .toBeLessThanOrEqual(NARROW_VIEWPORT_WIDTH - MIN_PANEL_VISIBLE_PX);
});
