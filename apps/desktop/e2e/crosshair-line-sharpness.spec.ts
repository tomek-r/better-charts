import { test, expect, chromium, devices, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';
import { decodePng, parseHexColor, pixelAt, type DecodedPng } from './helpers/pngPixels';
import { palette } from '../src/shared/theme/palette';

/**
 * The crosshair lines must land on whole device pixels: exactly floor(pixel ratio)
 * device pixels wide, at the full opaque line colour, with untouched neighbours. A
 * stroke centred on an integer device coordinate instead straddles two pixels and
 * renders as a blurry 2px line at half alpha on 1x displays.
 *
 * Each screenshot is compared against the same clip taken with the arrow pointer
 * (no lines), so the chart's own content under the clip cannot be mistaken for line
 * pixels. The clips cover the pane and the matching axis canvas of each line.
 */

const LINE_COLOR = parseHexColor(palette.textLabel);
const POINTER = { x: 300, y: 150 };
const CLIP_HALF_SPAN = 6;
const CLIP_LENGTH = 40;

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function waitTwoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function screenshotClip(page: Page, clip: Clip): Promise<DecodedPng> {
  await waitTwoAnimationFrames(page);
  return decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
}

async function selectCrosshair(page: Page): Promise<void> {
  await page.mouse.move(700, 700);
  await page.locator('.tool-rail-split').hover();
  await page.locator('.tool-rail-arrow').click();
  await page.locator('.tool-flyout').getByRole('menuitemradio', { name: 'Crosshair pointer' }).click();
}

/** Device-pixel coordinates (along `axis`) of every pixel that differs from the baseline, per scan line. */
function changedPositionsPerScanLine(
  withLines: DecodedPng,
  baseline: DecodedPng,
  axis: 'column' | 'row',
): { position: number; color: [number, number, number] }[][] {
  const scanLines = axis === 'column' ? withLines.height : withLines.width;
  const positions = axis === 'column' ? withLines.width : withLines.height;
  return Array.from({ length: scanLines }, (_, scanLine) => {
    const changed: { position: number; color: [number, number, number] }[] = [];
    for (let position = 0; position < positions; position++) {
      const [x, y] = axis === 'column' ? [position, scanLine] : [scanLine, position];
      const color = pixelAt(withLines, x, y);
      if (color.join() !== pixelAt(baseline, x, y).join()) {
        changed.push({ position, color });
      }
    }
    return changed;
  });
}

function expectOneSolidLine(
  changedPerScanLine: ReturnType<typeof changedPositionsPerScanLine>,
  expectedWidth: number,
): void {
  const firstPositions = changedPerScanLine[0].map(({ position }) => position);
  for (const changed of changedPerScanLine) {
    // Exactly the line's pixels differ: no tinted neighbour on either side.
    expect(changed.map(({ position }) => position)).toEqual(firstPositions);
    expect(changed).toHaveLength(expectedWidth);
    for (const { color } of changed) {
      expect(color).toEqual(LINE_COLOR);
    }
    // The line pixels are contiguous.
    expect(firstPositions[firstPositions.length - 1] - firstPositions[0]).toBe(expectedWidth - 1);
  }
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`crosshair line sharpness at device pixel ratio ${deviceScaleFactor}`, () => {
    test('both lines are whole opaque device pixels on the pane and on both axes', async ({ baseURL }) => {
      // Playwright's emulated deviceScaleFactor alone leaves the canvas bitmaps at 1x (the
      // device-pixel-content-box observer reports unscaled sizes), so the browser itself
      // is launched at the ratio as well. That flag cannot be set per describe group.
      const browser = await chromium.launch({
        args: deviceScaleFactor === 1 ? [] : [`--force-device-scale-factor=${deviceScaleFactor}`],
      });
      try {
        const context = await browser.newContext({ ...devices['Desktop Chrome'], baseURL, deviceScaleFactor });
        await expectSharpCrosshairLines(await context.newPage(), deviceScaleFactor);
      } finally {
        await browser.close();
      }
    });
  });
}

async function expectSharpCrosshairLines(page: Page, deviceScaleFactor: number): Promise<void> {
  const { pageErrors } = await gotoWithStub(page);
  await expect.poll(async () => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(10);
  const host = (await page.locator('.chart-host').boundingBox())!;
  const axis = await page.evaluate(() => window.__chartTest!.priceScale());
  const paneWidth = host.width - axis.axisWidth;
  const pointerX = host.x + POINTER.x;
  const pointerY = host.y + POINTER.y;
  const lineWidth = Math.max(1, Math.floor(deviceScaleFactor));

  // Vertical line: a short slice of the pane above the horizontal line, and of the time axis.
  const verticalClips: Clip[] = [
    { x: pointerX - CLIP_HALF_SPAN, y: host.y + 20, width: 2 * CLIP_HALF_SPAN, height: CLIP_LENGTH },
    { x: pointerX - CLIP_HALF_SPAN, y: host.y + axis.paneHeight + 2, width: 2 * CLIP_HALF_SPAN, height: 10 },
  ];
  // Horizontal line: a short slice of the pane left of the vertical line, and of the price axis.
  const horizontalClips: Clip[] = [
    { x: host.x + 20, y: pointerY - CLIP_HALF_SPAN, width: CLIP_LENGTH, height: 2 * CLIP_HALF_SPAN },
    { x: host.x + paneWidth + 2, y: pointerY - CLIP_HALF_SPAN, width: 10, height: 2 * CLIP_HALF_SPAN },
  ];

  await page.mouse.move(pointerX, pointerY);
  const baselines = [];
  for (const clip of [...verticalClips, ...horizontalClips]) {
    baselines.push(await screenshotClip(page, clip));
  }

  await selectCrosshair(page);
  await page.mouse.move(pointerX - 5, pointerY - 3);
  await page.mouse.move(pointerX, pointerY);
  await expect.poll(async () => page.evaluate(() => window.__chartTest?.tool('crosshair')?.linesVisible())).toBe(true);

  const clips = [...verticalClips, ...horizontalClips];
  for (const [index, clip] of clips.entries()) {
    const withLines = await screenshotClip(page, clip);
    const isVertical = index < verticalClips.length;
    expectOneSolidLine(
      changedPositionsPerScanLine(withLines, baselines[index], isVertical ? 'column' : 'row'),
      lineWidth,
    );
  }
  expect(pageErrors).toEqual([]);
}
