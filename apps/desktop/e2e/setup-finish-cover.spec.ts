import { expect, test, type Page } from '@playwright/test';
import type { BridgeStatus, MarketSnapshot } from '../src/shared/bridge/types';
import { markSetupCompleted, openStandaloneSetupGuide, walkGuideToConnectStep } from './helpers/setupGuide';
import { gotoWithStub, pushBridgeStatus, pushEvent, waitForBridgeListeners, windowCandles } from './helpers/tauriStub';

/**
 * A device keeps its workspace blurred from the moment its guide starts until "Happy trading", and
 * the hand-over to the finished screen is the reported blink: the guide's backdrop faded out while
 * nothing else covered the workspace, so the blur seemed to lift and settle back in. Only a blurred
 * `.bridge-screen` — the first-run screen, the wait after the setup, or the finished screen — covers
 * the workspace here, and every frame of the hand-over is judged on both kinds of device.
 */

/** A bridge that has not connected yet and holds no candles, so a blurred screen stands in for the chart. */
const WAITING_FOR_BRIDGE = {
  get_bridge_status: { state: 'connecting' },
  get_market_snapshot: { complete: false, candles: [] },
};

/** The status the stub pushes once the bridge answers, worded like the real one. */
const CONNECTED_STATUS: BridgeStatus = {
  state: 'connected',
  supportedTimeframes: ['M1'],
  message: 'Bridge connected.',
};

/** The connected session's first window before the EA answers: the bridge publishes it empty. */
const AWAITING_HISTORY: MarketSnapshot = { complete: false, candles: [] };

/** The window the EA answers with once its series synchronizes. */
const LATE_WINDOW: MarketSnapshot = {
  symbol: 'EURUSD',
  timeframe: 'M5',
  complete: true,
  candles: windowCandles(10),
};

/** Least opacity a blurred layer needs for the workspace behind it to count as covered. */
const COVER_OPACITY_MIN = 0.5;

/** How long the sampler runs: past the guide's 900 ms exit and the finished screen's arrival. */
const SAMPLE_WINDOW_MS = 2_500;

/** How many uncovered frames the failure message names before it counts the rest. */
const GAP_FRAMES_REPORTED = 8;

const setupComplete = (page: Page) => page.getByRole('dialog', { name: 'Setup complete' });
const waitingScreen = (page: Page) => page.getByRole('region', { name: 'Waiting for MetaTrader 5' });

/** One blurred screen of a frame: the workspace counts as covered while one of them covers it. */
interface CoverLayer {
  /** The screen's classes, so the failure message names what stood there instead. */
  label: string;
  /** Computed opacity: a layer fading out stops covering the workspace as it goes. */
  opacity: number;
  /** Only a blurred screen covers the workspace; a bare overlay would leave the chart sharp. */
  blurred: boolean;
  /** Whether this is the finished screen, whose arrival ends the hand-over the spec judges. */
  finished: boolean;
}

/** One sampled animation frame: the layers on the workspace, and how opaque each one was. */
interface CoverFrame {
  /** `performance.now()` at the frame the sampler saw. */
  atMs: number;
  /** Opacity of the guide's backdrop, or null when it is not in the workspace; it covers nothing. */
  guideBackdrop: number | null;
  /** Every `.bridge-screen` of the workspace, the finished screen included. */
  layers: CoverLayer[];
}

/** The page globals the sampler writes into: the frames, its end, and when the EA connected. */
interface CoverSamplerWindows {
  __coverFrames?: CoverFrame[];
  __coverSamplerDone?: boolean;
  __coverConnectAtMs?: number;
}

/** Installs a requestAnimationFrame sampler that records how every frame covers the workspace. */
async function startCoverSampler(page: Page): Promise<void> {
  await page.evaluate((durationMs) => {
    const sampler = window as unknown as CoverSamplerWindows;
    const frames: CoverFrame[] = [];
    const startedAt = performance.now();
    const opacityOf = (element: Element | null): number | null => {
      return element === null ? null : Number(getComputedStyle(element).opacity);
    };
    const layerOf = (element: Element): CoverLayer => {
      const style = getComputedStyle(element);
      return {
        label: `.${Array.from(element.classList).join('.')}`,
        opacity: Number(style.opacity),
        blurred: style.backdropFilter.includes('blur'),
        finished: element.classList.contains('setup-complete-screen'),
      };
    };
    const sample = (): void => {
      frames.push({
        atMs: performance.now(),
        guideBackdrop: opacityOf(document.querySelector('.setup-guide-backdrop')),
        layers: Array.from(document.querySelectorAll('.bridge-screen')).map(layerOf),
      });
      if (performance.now() - startedAt >= durationMs) {
        sampler.__coverSamplerDone = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    sampler.__coverFrames = frames;
    sampler.__coverSamplerDone = false;
    requestAnimationFrame(sample);
  }, SAMPLE_WINDOW_MS);
}

/** Marker of the moment the EA connects, as the sampler's frames time it. */
async function markConnect(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as CoverSamplerWindows).__coverConnectAtMs = performance.now();
  });
}

/** How many frames the sampler recorded so far, so a test can wait for it to be live. */
async function sampledFrames(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as CoverSamplerWindows).__coverFrames?.length ?? 0);
}

/** Waits until the sampler stopped, a little past the window it samples. */
async function waitForSamplerDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as CoverSamplerWindows).__coverSamplerDone === true), {
      timeout: SAMPLE_WINDOW_MS + 10_000,
    })
    .toBe(true);
}

/** Every frame the sampler recorded, oldest first. */
async function coverFrames(page: Page): Promise<CoverFrame[]> {
  return page.evaluate(() => (window as unknown as CoverSamplerWindows).__coverFrames ?? []);
}

/** When the EA connected, as the sampler timed it. */
async function connectAtMs(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as CoverSamplerWindows).__coverConnectAtMs ?? 0);
}

/** Hands the page the EA's connection in the bridge's own order, exactly as the real one publishes it. */
async function deliverConnection(page: Page): Promise<void> {
  await markConnect(page);
  await pushBridgeStatus(page, CONNECTED_STATUS);
  await pushEvent(page, 'market-snapshot', AWAITING_HISTORY);
  await pushEvent(page, 'market-snapshot', LATE_WINDOW);
}

/** Whether a blurred screen covered the workspace in this frame: on it, and opaque enough. */
function frameCovered(frame: CoverFrame): boolean {
  return frame.layers.some((layer) => layer.blurred && layer.opacity > COVER_OPACITY_MIN);
}

/** One layer as the failure message names it. */
function layerState(layer: CoverLayer): string {
  return `${layer.label}: opacity ${layer.opacity.toFixed(2)}, ${layer.blurred ? 'blurred' : 'no blur'}`;
}

/** Every layer of one frame, so an uncovered frame says what stood there instead. */
function describeFrame(frame: CoverFrame): string {
  const guide = frame.guideBackdrop === null ? 'absent' : `opacity ${frame.guideBackdrop.toFixed(2)}`;
  const layers = frame.layers.map(layerState);
  return [`.setup-guide-backdrop: ${guide}`, ...(layers.length > 0 ? layers : ['no blurred screen'])].join(', ');
}

/** The first uncovered frames with their time since the EA connected, so the gap is diagnosable. */
function gapMessage(frames: CoverFrame[], uncovered: number[], connectedAtMs: number): string {
  const reported = uncovered.slice(0, GAP_FRAMES_REPORTED).map((index) => {
    const frame = frames[index];
    return `  frame ${index} (+${Math.round(frame.atMs - connectedAtMs)} ms): ${describeFrame(frame)}`;
  });
  const rest = uncovered.length - reported.length;
  const more = rest > 0 ? `\n  ${rest} further uncovered frames not shown` : '';
  return (
    `${uncovered.length} of ${frames.length} frames left the workspace uncovered after the EA connected:\n` +
    `${reported.join('\n')}${more}`
  );
}

/** Samples the hand-over and asserts that a blurred screen covered the workspace in every frame. */
async function expectCoverThroughHandOver(page: Page): Promise<void> {
  // Sample every frame from before the bridge answers: the reported blink falls between two layers.
  await startCoverSampler(page);
  await waitForBridgeListeners(page);
  await expect.poll(() => sampledFrames(page)).toBeGreaterThan(0);

  await deliverConnection(page);
  // The finished screen stands on the blur the guide left, so it arrives whole instead of fading in.
  const complete = setupComplete(page);
  await expect(complete).toBeVisible();
  await expect(complete).toHaveClass(/setup-complete-over-screen/);
  await waitForSamplerDone(page);

  const frames = await coverFrames(page);
  const connectedAtMs = await connectAtMs(page);
  // The hand-over really happened inside the sampled window, or the assertions below prove nothing.
  expect(frames.some((frame) => frame.guideBackdrop !== null)).toBe(true);
  expect(frames.some((frame) => frame.layers.some((layer) => layer.finished))).toBe(true);

  const uncovered = frames.flatMap((frame, index) => (frameCovered(frame) ? [] : [index]));
  expect(uncovered.length, gapMessage(frames, uncovered, connectedAtMs)).toBe(0);
}

/** The guide over the first-run setup screen, waiting on its Connect step. */
async function openFirstRunGuideAtConnect(page: Page): Promise<void> {
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await walkGuideToConnectStep(await openStandaloneSetupGuide(page));
}

/** The guide's Connect step on a finished setup, opened from App settings over the blurred wait. */
async function openCompletedSetupGuideAtConnect(page: Page): Promise<void> {
  await markSetupCompleted(page);
  await gotoWithStub(page, { responses: WAITING_FOR_BRIDGE });
  await expect(waitingScreen(page)).toBeVisible();

  // The blurred wait makes the window inert, so App settings takes a direct click, not a pointer one.
  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  await gear.evaluate((button) => (button as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'How to set up the bridge connection' }).click();
  const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
  await expect(guide).toBeVisible();
  await walkGuideToConnectStep(guide);
}

test('the first-run setup stays blurred from the guide to the finished screen', async ({ page }) => {
  await openFirstRunGuideAtConnect(page);
  await expectCoverThroughHandOver(page);
});

test('a finished setup stays blurred from the guide to the finished screen', async ({ page }) => {
  // App settings and the guide above it lie over the waiting screen: the blur is what is measured.
  await openCompletedSetupGuideAtConnect(page);
  await expectCoverThroughHandOver(page);
});
