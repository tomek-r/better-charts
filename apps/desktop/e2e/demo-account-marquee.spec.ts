import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoErrors, gotoWithStub, pushEvent } from './helpers/tauriStub';

/** Only the fields the notice's source reads; the bridge normalizer fills the rest. */
const DEMO_ACCOUNT = {
  accountLogin: '50123456',
  brokerServer: 'Broker-Demo',
  accountTradeMode: 0,
  accountTradeModeName: 'demo',
  currency: 'USD',
  currencyDigits: 2,
};

/** The same account in the other trade modes the badge and the notice both read. */
const REAL_ACCOUNT_OVERRIDES = { accountTradeMode: 2, accountTradeModeName: 'real' };
const CONTEST_ACCOUNT_OVERRIDES = { accountTradeMode: 1, accountTradeModeName: 'contest' };

/** The strip's sentences in reading order, as the marquee and the assistive-tech copy must carry them. */
const NOTICE_SENTENCES = [
  'Demo account. No real money is involved.',
  "Orders here use your broker's demo funds.",
  'Switch to a real account in MT5 to trade live.',
];
const READABLE_NOTICE = NOTICE_SENTENCES.join(' ');
const STRIP_HEIGHT = 14;
/** The bar's own height, which the feature must leave exactly as it was. */
const TOP_BAR_HEIGHT = 68;

const noticeStrip = (page: Page): Locator => page.locator('.demo-notice');

const columnGap = (marquee: Locator): Promise<number> =>
  marquee.evaluate((element) => Number.parseFloat(getComputedStyle(element).columnGap));

/** The one decorative copy of the notice: all three sentences share a single moving element. */
async function expectOneMovingNotice(strip: Locator): Promise<Locator> {
  const marquee = strip.locator('[aria-hidden="true"]');
  await expect(marquee).toHaveCount(1);
  // The sentences ride in one row, in order, spaced by the gap and nothing else.
  await expect(marquee.locator('.demo-notice-sentence')).toHaveText(NOTICE_SENTENCES);
  await expect(marquee).toHaveCSS('white-space', 'nowrap');
  await expect(marquee).toHaveCSS('font-size', '10px');
  await expect(marquee).toHaveCSS('animation-name', 'demo-notice-scroll');
  await expect(marquee).toHaveCSS('animation-duration', '60s');
  const playStates = await marquee.evaluate((element) => element.getAnimations().map(({ playState }) => playState));
  expect(playStates).toEqual(['running']);
  return marquee;
}

// The owner's feedback: the strip overlays the bar instead of reserving a band in it, so the notice
// arriving with the first account snapshot may move neither the bar nor the chart below it.
test('a demo account scrolls the notice across an absolute strip inside the top bar', async ({ page }) => {
  const collected = await gotoWithStub(page);
  const strip = noticeStrip(page);
  await expect(strip).toBeVisible();
  await expect(strip).toHaveCSS('position', 'absolute');
  // Chrome, not a control: clicks and the keyboard pass through the strip.
  await expect(strip).toHaveCSS('pointer-events', 'none');
  // Assistive tech reads the three sentences once, in order; the scrolling copy beside it is decoration.
  await expect(strip.locator('.demo-notice-readable')).toHaveText(READABLE_NOTICE);
  await expectOneMovingNotice(strip);
  await expect(strip.locator('a, button, input, select, textarea, [tabindex]')).toHaveCount(0);
  const bar = (await page.locator('header.topbar').boundingBox())!;
  const band = (await strip.boundingBox())!;
  expect(band.width).toBe(bar.width);
  expect(band.height).toBe(STRIP_HEIGHT);
  // Anchored to the bar's bottom edge, inside the bar rather than below it.
  expect(Math.abs(band.y + band.height - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  // And there it stays clear of the bar's controls, so it can never cover a click target.
  const actions = (await page.locator('.topbar-actions').boundingBox())!;
  expect(actions.y + actions.height).toBeLessThanOrEqual(band.y);
  expectNoErrors(collected);
});

// The owner's window: the strip is far wider than the sentence row, so the loop must not depend on
// the sentences being repeated into a track as wide as the window.
test('at a 2000px wide window the sentences still cycle in one moving copy', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await gotoWithStub(page);
  const strip = noticeStrip(page);
  await expect(strip).toBeVisible();
  const marquee = await expectOneMovingNotice(strip);
  const band = (await strip.boundingBox())!;
  expect(band.width).toBeGreaterThan(1900);
  expect(await columnGap(marquee)).toBeGreaterThan(300);
  // Exactly one moving element, not a track repeated until it fills the window.
  await expect(strip.locator('.demo-notice-text')).toHaveCount(1);
  // Still animating at that width, not stalled in a start or end state.
  expect(await marquee.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
});

// The gap scales with the strip's width: tight on a small window, roomy on a big one.
test('at an 800px wide window the sentences sit closer together', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoWithStub(page);
  const marquee = await expectOneMovingNotice(noticeStrip(page));
  expect(await columnGap(marquee)).toBeLessThan(140);
});

test('the strip takes no layout space for a real or a demo account', async ({ page }) => {
  const collected = await gotoWithStub(page, { accountOverrides: REAL_ACCOUNT_OVERRIDES });
  await expect(page.locator('.topbar-actions .account-badge')).toHaveText(/Real$/);
  await expect(noticeStrip(page)).toHaveCount(0);
  const bar = page.locator('header.topbar');
  const barWithRealAccount = (await bar.boundingBox())!;
  const chartTopWithRealAccount = (await page.locator('.chart-section').boundingBox())!.y;
  // Nothing is reserved for the strip: the bar keeps its pre-feature height and no bottom padding.
  expect(barWithRealAccount.height).toBe(TOP_BAR_HEIGHT);
  await expect(bar).toHaveCSS('padding-bottom', '0px');
  // The badge and the notice read one source, so the same account turned demo brings the strip in.
  await pushEvent(page, 'account-snapshot', DEMO_ACCOUNT);
  const strip = noticeStrip(page);
  await expect(strip).toBeVisible();
  await expect(strip).toHaveCSS('position', 'absolute');
  const band = (await strip.boundingBox())!;
  expect(Math.abs(band.y + band.height - (barWithRealAccount.y + barWithRealAccount.height))).toBeLessThanOrEqual(1);
  expect((await bar.boundingBox())!.height).toBe(barWithRealAccount.height);
  expect((await page.locator('.chart-section').boundingBox())!.y).toBe(chartTopWithRealAccount);
  expectNoErrors(collected);
});

test('a contest account carries the same notice', async ({ page }) => {
  await gotoWithStub(page, { accountOverrides: CONTEST_ACCOUNT_OVERRIDES });
  await expect(page.locator('.topbar-actions .account-badge')).toHaveText(/Contest$/);
  await expect(noticeStrip(page)).toBeVisible();
});

test('the notice goes away when the bridge is not connected', async ({ page }) => {
  await gotoWithStub(page);
  await expect(noticeStrip(page)).toBeVisible();
  await pushEvent(page, 'bridge-status', { state: 'disconnected', message: 'Bridge disconnected.' });
  await expect(noticeStrip(page)).toHaveCount(0);
});

test('reduced motion shows the first sentence only, static and centred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoWithStub(page);
  const strip = noticeStrip(page);
  await expect(strip).toBeVisible();
  const marquee = strip.locator('[aria-hidden="true"]');
  await expect(marquee).toHaveCount(1);
  await expect(marquee).toHaveCSS('animation-name', 'none');
  expect(await marquee.evaluate((element) => element.getAnimations().length)).toBe(0);
  // The follow-on sentences are hidden, so the static strip never runs past its edge.
  const sentences = marquee.locator('.demo-notice-sentence');
  await expect(sentences).toHaveText(NOTICE_SENTENCES);
  await expect(sentences.nth(0)).toBeVisible();
  await expect(sentences.nth(1)).toBeHidden();
  await expect(sentences.nth(2)).toBeHidden();
  const copy = (await sentences.nth(0).boundingBox())!;
  const band = (await strip.boundingBox())!;
  expect(Math.abs(copy.x + copy.width / 2 - (band.x + band.width / 2))).toBeLessThanOrEqual(2);
});
