import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPortfolio } from './helpers/portfolioPage';
import { wasInvoked } from './helpers/tauriStub';

async function lastCloseVolume(page: Page) {
  await expect.poll(async () => (await wasInvoked(page, 'close_position')) !== undefined).toBe(true);
  return (await wasInvoked(page, 'close_position'))?.args.volume;
}

async function openCustomPopover(page: Page, menuButton: Locator) {
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Custom volume…' }).click();
  return page.getByRole('form', { name: 'Close part of EURUSD BUY' });
}

test.describe('split button geometry', () => {
  test('Close and the caret share one top and bottom edge', async ({ page }) => {
    const { mainClose, menuButton } = await openPortfolio(page);
    const close = await mainClose.boundingBox();
    const caret = await menuButton.boundingBox();
    expect(close).not.toBeNull();
    expect(caret).not.toBeNull();
    expect(Math.abs(caret!.height - close!.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(caret!.y - close!.y)).toBeLessThanOrEqual(0.5);
  });

  test('hovering the caret draws its own full border over the divider without layout shift', async ({ page }) => {
    const { mainClose, menuButton } = await openPortfolio(page);
    // The drawer slides in; measure only once the caret has stopped moving.
    let previousX = Number.NaN;
    await expect
      .poll(async () => {
        const x = (await menuButton.boundingBox())!.x;
        const settled = x === previousX;
        previousX = x;
        return settled;
      })
      .toBe(true);
    const restClose = (await mainClose.boundingBox())!;
    const restCaret = (await menuButton.boundingBox())!;
    await menuButton.hover();
    const border = await menuButton.evaluate((el) => {
      const style = getComputedStyle(el);
      return { left: style.borderLeftColor, top: style.borderTopColor, width: style.borderLeftWidth };
    });
    expect(border.width).toBe('1px');
    expect(border.left).toBe(border.top);
    const hoverClose = (await mainClose.boundingBox())!;
    const hoverCaret = (await menuButton.boundingBox())!;
    // Compare sizes and the Close-to-caret offset: the drawer itself may be repositioned by the hover.
    const shape = (close: typeof restClose, caret: typeof restCaret) => [
      close.width,
      close.height,
      caret.width,
      caret.height,
      caret.x - close.x,
      caret.y - close.y,
    ];
    const rest = shape(restClose, restCaret);
    shape(hoverClose, hoverCaret).forEach((value, index) => {
      expect(Math.abs(value - rest[index]!)).toBeLessThanOrEqual(0.5);
    });
    // The caret overlaps Close's right border, so at the divider the caret must be the top-most element.
    const topIsCaret = await menuButton.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.left + 0.5, box.top + box.height / 2) === el;
    });
    expect(topIsCaret).toBe(true);
  });

  test('hovering Close draws its own full right border over the divider', async ({ page }) => {
    const { mainClose } = await openPortfolio(page);
    await mainClose.hover();
    const result = await mainClose.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        topIsClose: document.elementFromPoint(box.right - 0.5, box.top + box.height / 2) === el,
        right: style.borderRightColor,
        top: style.borderTopColor,
      };
    });
    expect(result.topIsClose).toBe(true);
    expect(result.right).toBe(result.top);
  });
});

test.describe('split button visibility', () => {
  test('is hidden without the capability, without limits, and for a minimum-lot position', async ({ page }) => {
    let view = await openPortfolio(page, {}, { partialClose: false });
    await expect(view.mainClose).toBeVisible();
    await expect(view.menuButton).toHaveCount(0);

    view = await openPortfolio(page, { volume_min: null, volume_step: null });
    await expect(view.mainClose).toBeVisible();
    await expect(view.menuButton).toHaveCount(0);

    view = await openPortfolio(page, { volume: '0.01' });
    await expect(view.mainClose).toBeVisible();
    await expect(view.menuButton).toHaveCount(0);
  });

  test('plain Close still sends a full close', async ({ page }) => {
    const { mainClose, menuButton } = await openPortfolio(page);
    await expect(menuButton).toBeVisible();
    await mainClose.click();
    expect(await lastCloseVolume(page)).toBeNull();
  });
});

test.describe('preset menu', () => {
  test('shows rounded lot sizes and sends the chosen volume immediately', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '0.10' });
    await menuButton.click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveText([
      'Close 25%0.02 units',
      'Close 50%0.05 units',
      'Close 75%0.07 units',
      'Custom volume…',
    ]);
    await page.getByRole('menuitem', { name: /Close 75%/ }).click();
    expect(await lastCloseVolume(page)).toBe('0.07');
  });

  test('displays the EA 8-decimal volumes without trailing zeros', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, {
      volume: '0.10000000',
      volume_min: '0.01000000',
      volume_step: '0.01000000',
    });
    await expect(page.locator('.portfolio-open')).toContainText(/Position\s*buy\s*0\.1 units/);
    await expect(page.locator('.portfolio-open')).not.toContainText('0.10000000');
    await menuButton.click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Close 25%0.02 units',
      'Close 50%0.05 units',
      'Close 75%0.07 units',
      'Custom volume…',
    ]);
    await page.getByRole('menuitem', { name: 'Custom volume…' }).click();
    const popover = page.getByRole('form', { name: 'Close part of EURUSD BUY' });
    await expect(popover).toContainText('of 0.1 units');
    await expect(popover.getByLabel('Volume to close')).toHaveValue('0.05');
    await expect(popover.locator('.partial-bar-labels')).toHaveText('Close 0.05Keep 0.05');
    await popover.getByRole('button', { name: 'Close', exact: true }).click();
    const sent = await lastCloseVolume(page);
    expect(sent).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(sent)).toBe(0.05);
  });

  test('hides presets that are not a valid partial volume', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '0.03' });
    await menuButton.click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Close 50%0.01 units',
      'Close 75%0.02 units',
      'Custom volume…',
    ]);
  });

  test('supports keyboard navigation and Escape', async ({ page }) => {
    const { menuButton } = await openPortfolio(page);
    await menuButton.click();
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: 'Custom volume…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('a rejected partial close shows the existing error notification', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, {}, { failures: { close_position: 'Partial close rejected.' } });
    await menuButton.click();
    await page.getByRole('menuitem', { name: /Close 25%/ }).click();
    await expect(page.locator('.notification-region [role=alert]')).toContainText('Partial close rejected');
  });
});

test.describe('custom volume popover', () => {
  test('validates the volume and keeps Close disabled while invalid', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '1.00' });
    const popover = await openCustomPopover(page, menuButton);
    const input = popover.getByLabel('Volume to close');
    const confirm = popover.getByRole('button', { name: 'Close', exact: true });
    await expect(popover).toContainText('of 1 units');
    await expect(input).toHaveValue('0.5');
    await expect(popover.locator('.partial-bar-labels')).toHaveText('Close 0.5Keep 0.5');

    await input.fill('0');
    await expect(popover.getByRole('alert')).toHaveText('Enter at least 0.01 units.');
    await expect(confirm).toBeDisabled();
    await input.fill('1.5');
    await expect(popover.getByRole('alert')).toHaveText('The position is only 1 units.');
    await expect(confirm).toBeDisabled();

    await page.getByRole('button', { name: 'Dismiss partial close' }).click();
    await expect(popover).toHaveCount(0);
  });

  test('flags a remainder below the minimum lot', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '0.10', volume_min: '0.04' });
    const popover = await openCustomPopover(page, menuButton);
    await popover.getByLabel('Volume to close').fill('0.07');
    await expect(popover.getByRole('alert')).toHaveText(
      'The amount left would be below the 0.04 units minimum. Close all instead.',
    );
    await expect(popover.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  });

  test('steps, snaps to the lot step, accepts a comma and sends the volume', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '1.00' });
    const popover = await openCustomPopover(page, menuButton);
    const input = popover.getByLabel('Volume to close');
    await popover.getByLabel('Increase volume').click();
    await expect(input).toHaveValue('0.51');
    await input.fill('0,337');
    await input.blur();
    await expect(input).toHaveValue('0.33');
    await popover.getByRole('button', { name: '25%' }).click();
    await expect(input).toHaveValue('0.25');
    await popover.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await lastCloseVolume(page)).toBe('0.25');
    await expect(popover).toHaveCount(0);
  });

  test('the close/keep bar is a slider synced with the input', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '1.00' });
    const popover = await openCustomPopover(page, menuButton);
    const input = popover.getByLabel('Volume to close');
    const slider = popover.getByRole('slider', { name: 'Close volume' });
    const labels = popover.locator('.partial-bar-labels');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Close 0.5 of 1 units');

    const box = (await slider.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect(input).toHaveValue(/^0\.2\d?$/);
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(input).toHaveValue(/^0\.7\d?$/);
    const closed = Number(await input.inputValue());
    await expect(labels).toHaveText(`Close ${closed}Keep ${Math.round((1 - closed) * 100) / 100}`);

    await input.fill('0.2');
    await expect(slider).toHaveValue('20');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(input).toHaveValue('0.21');
    await page.keyboard.press('ArrowLeft');
    await expect(input).toHaveValue('0.2');
    await page.keyboard.press('Home');
    await expect(input).toHaveValue('0.01');
    await page.keyboard.press('End');
    await expect(input).toHaveValue('1');
    await expect(labels).toHaveText('Close 1Keep 0');
    await popover.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await lastCloseVolume(page)).toBeNull();
  });

  test('the slider never selects a remainder below the minimum and sends its volume', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '0.10', volume_min: '0.04' });
    const popover = await openCustomPopover(page, menuButton);
    const input = popover.getByLabel('Volume to close');
    const slider = popover.getByRole('slider', { name: 'Close volume' });
    await slider.focus();
    await page.keyboard.press('End');
    await expect(input).toHaveValue('0.1');
    await page.keyboard.press('ArrowLeft');
    await expect(input).toHaveValue('0.06');
    await page.keyboard.press('ArrowRight');
    await expect(input).toHaveValue('0.1');
    await page.keyboard.press('ArrowLeft');
    await expect(popover.getByRole('alert')).toHaveCount(0);
    await expect(popover.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    await popover.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await lastCloseVolume(page)).toBe('0.06');
  });

  test('All performs a full close', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '1.00' });
    const popover = await openCustomPopover(page, menuButton);
    await popover.getByRole('button', { name: 'All' }).click();
    await popover.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await lastCloseVolume(page)).toBeNull();
  });

  test('disables the row Close while open and re-enables it on Cancel and Escape', async ({ page }) => {
    const { mainClose, menuButton } = await openPortfolio(page);
    const popover = await openCustomPopover(page, menuButton);
    await expect(mainClose).toBeDisabled();
    await expect(mainClose).toHaveAttribute('title', 'Finish or cancel the partial close first');
    await popover.getByRole('button', { name: 'Cancel' }).click();
    await expect(popover).toHaveCount(0);
    await expect(mainClose).toBeEnabled();

    await openCustomPopover(page, menuButton);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(mainClose).toBeEnabled();
  });

  test('fits the narrow drawer without horizontal overflow', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '1.00' });
    const popover = await openCustomPopover(page, menuButton);
    const card = (await page.locator('.portfolio-card').boundingBox())!;
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 1);
    expect(await popover.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
});

test.describe('custom volume popover overlay', () => {
  const second = { ticket: '1002', positionId: '885002', symbol: 'GBPUSD' };

  test('floats below its row without pushing the next row down', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, {}, { morePositions: [second] });
    const items = page.locator('.portfolio-item');
    // Measured relative to the first row: scrolling the drawer to reveal the popover shifts both.
    const gap = async () => (await items.nth(1).boundingBox())!.y - (await items.nth(0).boundingBox())!.y;
    const before = await gap();
    const popover = await openCustomPopover(page, menuButton.first());
    await expect(popover).toBeVisible();
    expect(Math.abs((await gap()) - before)).toBeLessThanOrEqual(0.5);
    expect(await popover.evaluate((node) => getComputedStyle(node).position)).toBe('absolute');
    const row = (await page.locator('.portfolio-row').first().boundingBox())!;
    const box = (await popover.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(row.y + row.height - 0.5);
    expect(Math.abs(box.x - row.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.width - row.width)).toBeLessThanOrEqual(0.5);
  });

  test('is fully visible when opened on the last row', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, {}, { morePositions: [second] });
    await menuButton.last().click();
    await page.getByRole('menuitem', { name: 'Custom volume…' }).click();
    const popover = page.getByRole('form', { name: 'Close part of GBPUSD BUY' });
    await expect(popover).toBeVisible();
    const panel = (await page.locator('.trade-panel').boundingBox())!;
    const box = (await popover.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(panel.y);
    expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height + 0.5);
    // Nothing may paint over it: the topmost element at its centre is inside the popover.
    expect(
      await popover.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
  });
});

test.describe('narrow drawer containment', () => {
  async function expectInside(inner: Locator, outer: Locator, page: Page) {
    const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
    const viewport = page.viewportSize();
    expect(innerBox).not.toBeNull();
    expect(outerBox).not.toBeNull();
    expect(innerBox!.x).toBeGreaterThanOrEqual(outerBox!.x - 0.5);
    expect(innerBox!.x + innerBox!.width).toBeLessThanOrEqual(outerBox!.x + outerBox!.width + 0.5);
    expect(innerBox!.x + innerBox!.width).toBeLessThanOrEqual(viewport!.width);
  }

  test('preset menu stays inside the trade-panel drawer', async ({ page }) => {
    const { menuButton } = await openPortfolio(page, { volume: '0.10' });
    await menuButton.click();
    const menu = page.getByRole('menu', { name: 'Close part of position' });
    await expect(menu).toBeVisible();
    await expectInside(menu, page.locator('.portfolio-row'), page);
    await expect(page.getByRole('menuitem').first()).toHaveText(/Close 25%/);
  });
});
