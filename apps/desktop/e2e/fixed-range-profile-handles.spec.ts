import { test, expect, type Page } from '@playwright/test';
import { profileBoundaries, profileDrawings } from './helpers/chartTest';
import { commitProfile, position } from './helpers/fixedRangeProfilePage';

/**
 * The boundary lines and circles of a committed profile show only while it is selected. A drawing is
 * selected by the press that places it and by a press on its band; a press anywhere else deselects it.
 */

/** Bar slots of the default range placed by `select`: the band covers slots 2 to 6. */
const OUTSIDE_BAND_SLOT = 9;
const INSIDE_BAND_SLOT = 4;

async function handlesShown(page: Page) {
  return (await profileDrawings(page))![0].handlesShown;
}

async function clickSlot(page: Page, slot: number) {
  const point = await position(page, slot);
  await page.mouse.click(point.x, point.y);
}

test('the handles show while the profile is selected and hide when a press elsewhere deselects it', async ({
  page,
}) => {
  await commitProfile(page);
  await expect.poll(() => handlesShown(page)).toBe(true);

  await clickSlot(page, OUTSIDE_BAND_SLOT);
  await expect.poll(() => handlesShown(page)).toBe(false);

  await clickSlot(page, INSIDE_BAND_SLOT);
  await expect.poll(() => handlesShown(page)).toBe(true);
});

test('a press on the hidden handle of an unselected profile selects it without dragging the boundary', async ({
  page,
}) => {
  await commitProfile(page);
  await clickSlot(page, OUTSIDE_BAND_SLOT);
  await expect.poll(() => handlesShown(page)).toBe(false);
  const before = (await profileBoundaries(page))!;
  const host = (await page.locator('.chart-host').boundingBox())!;
  const target = await position(page, OUTSIDE_BAND_SLOT);

  await page.mouse.move(host.x + before.fromX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => handlesShown(page)).toBe(true);
  expect((await profileBoundaries(page))!.range).toEqual(before.range);
});
