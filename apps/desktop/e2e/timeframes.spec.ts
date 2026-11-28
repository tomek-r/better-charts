import { test, expect } from '@playwright/test';
import { gotoWithStub, stubInvocations, pushEvent } from './helpers/tauriStub';
import {
  timeframeBarTime,
  timeframeBarOffset,
  timeframeLabel,
  timeframeLongLabel,
  timeframeSeconds,
  timeframeSection,
} from '../src/shared/bridge/timeframes';
import {
  DEFAULT_TIMEFRAME_FAVORITES,
  loadTimeframeFavorites,
} from '../src/features/chart/timeframes/timeframeFavorites';
import { futurePoints } from '../src/features/chart/engine/timeScale/futureTimePoints';
import { BrokerTime } from '../src/features/chart/engine/brokerTime/brokerTime';
import { BarCountdownClock } from '../src/features/chart/engine/barCountdown/barCountdownClock';

const periods = [
  ['M1', '1m'],
  ['M2', '2m'],
  ['M3', '3m'],
  ['M4', '4m'],
  ['M5', '5m'],
  ['M6', '6m'],
  ['M10', '10m'],
  ['M12', '12m'],
  ['M15', '15m'],
  ['M20', '20m'],
  ['M30', '30m'],
  ['H1', '1H'],
  ['H2', '2H'],
  ['H3', '3H'],
  ['H4', '4H'],
  ['H6', '6H'],
  ['H8', '8H'],
  ['H12', '12H'],
  ['D1', '1D'],
  ['W1', '1W'],
  ['MN1', '1M'],
];

const longLabels: Record<string, string> = {
  M1: '1 minute',
  M2: '2 minutes',
  H1: '1 hour',
  H4: '4 hours',
  D1: '1 day',
  W1: '1 week',
  MN1: '1 month',
};

test('long labels are singular for one and plural otherwise', () => {
  for (const [wire, label] of Object.entries(longLabels)) {
    expect(timeframeLongLabel(wire)).toBe(label);
  }
  expect(timeframeLongLabel('X9')).toBe('X9');
  expect(timeframeSection('M30')).toBe('minutes');
  expect(timeframeSection('H12')).toBe('hours');
  expect(['D1', 'W1', 'MN1'].map(timeframeSection)).toEqual(['days', 'days', 'days']);
});

test('favorites storage falls back to defaults and drops unknown or repeated codes', () => {
  const stored = (value: string | null) => ({ getItem: () => value });
  const defaults = [...DEFAULT_TIMEFRAME_FAVORITES];
  expect(loadTimeframeFavorites(stored(null))).toEqual(defaults);
  expect(loadTimeframeFavorites(stored('{not json'))).toEqual(defaults);
  expect(loadTimeframeFavorites(stored('{"M1":true}'))).toEqual(defaults);
  const blocked = {
    getItem: (): string => {
      throw new Error('blocked');
    },
  };
  expect(loadTimeframeFavorites(blocked)).toEqual(defaults);
  expect(loadTimeframeFavorites(stored('[]'))).toEqual([]);
  expect(loadTimeframeFavorites(stored('["H2","H2","BOGUS",7,"M3"]'))).toEqual(['H2', 'M3']);
});

test('every advertised MT5 period can request history through the menu', async ({ page }) => {
  const errors = await gotoWithStub(page);
  const group = page.getByRole('group', { name: 'Chart timeframe' });
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  await expect(group.getByRole('button')).toHaveText(['1m', '5m', '15m', '1H', '4H', '1D', '1M']);
  for (const [wire, label] of periods) {
    await page.getByRole('button', { name: 'More timeframes' }).click();
    await menu.getByRole('button', { name: timeframeLongLabel(wire), exact: true }).click();
    await expect(menu).toHaveCount(0);
    // A non-favorite stays visible while active.
    await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(
      (await stubInvocations(page)).filter((entry) => entry.cmd === 'request_history').at(-1)?.args.timeframe,
    ).toBe(wire);
  }
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('the selector follows the EA subset and updates its choices on reconnect', async ({ page }) => {
  await gotoWithStub(page, {
    responses: { get_bridge_status: { state: 'connected', supportedTimeframes: ['M1', 'M2', 'MN1'] } },
  });
  const group = page.getByRole('group', { name: 'Chart timeframe' });
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  const rows = menu.locator('.timeframe-menu-select');
  // The tick intervals are the app's own, so they come first whatever the EA advertises.
  const tickRows = ['1 tick', '10 ticks', '100 ticks', '1000 ticks'];
  await expect(group.getByRole('button')).toHaveText(['1m', '1M']);
  await page.getByRole('button', { name: 'More timeframes' }).click();
  await expect(rows).toHaveText([...tickRows, '1 minute', '2 minutes', '1 month']);
  await pushEvent(page, 'bridge-status', { state: 'connected', supportedTimeframes: ['M1', 'H12', 'D1'] });
  await expect(group.getByRole('button')).toHaveText(['1m', '1D']);
  await expect(rows).toHaveText([...tickRows, '1 minute', '12 hours', '1 day']);
});

test('every timeframe row shows its star without hovering, favorite or not', async ({ page }) => {
  await gotoWithStub(page);
  await page.getByRole('button', { name: 'More timeframes' }).click();
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  // Park the pointer outside the menu so no row is hovered.
  await page.mouse.move(0, 0);
  // 2m is not a default favorite, 1m is.
  await expect(menu.getByRole('button', { name: 'Add 2m to favorites', exact: true })).toHaveCSS('opacity', '1');
  await expect(menu.getByRole('button', { name: 'Remove 1m from favorites', exact: true })).toHaveCSS('opacity', '1');
});

test('all periods fit a narrow chart without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await gotoWithStub(page);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect(page.getByRole('group', { name: 'Chart timeframe' }).getByRole('button')).toHaveCount(7);
  expect(await noOverflow()).toBe(true);
  await page.getByRole('button', { name: 'More timeframes' }).click();
  const menu = page.getByRole('dialog', { name: 'Timeframes' });
  // Every MT5 period the stub advertises, plus the app's four tick intervals.
  await expect(menu.locator('.timeframe-menu-select')).toHaveCount(25);
  expect(await noOverflow()).toBe(true);
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(480);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
});

const seconds = (date: string) => Date.parse(date) / 1000;

// Pinned because the subject is month alignment known answers: leap February 2024 and the Dec to Jan rollover.
test('monthly padding follows calendar boundaries through leap February', () => {
  const start = seconds('2024-01-01T00:00:00Z');
  expect(futurePoints(start, 'MN1', 96, 3).map((point) => point.time)).toEqual([
    seconds('2024-02-01T00:00:00Z'),
    seconds('2024-03-01T00:00:00Z'),
    seconds('2024-04-01T00:00:00Z'),
  ]);
  expect(timeframeBarTime('MN1', seconds('2023-12-01T00:00:00Z'), 1)).toBe(start);
  expect(timeframeBarOffset('MN1', start, seconds('2024-02-15T12:00:00Z'))).toBe(1.5);
  expect(timeframeBarTime('W1', start, 1)).toBe(seconds('2024-01-08T00:00:00Z'));
  expect(timeframeLabel('MN1')).toBe('1M');
  expect(timeframeLabel('M1')).toBe('1m');
});

/** Countdown text with the broker at the second of two quotes a second apart, one bar open at `barStart`. */
function countdownText(wire: string, barStart: string, quoteTime: string): string {
  const brokerTime = new BrokerTime();
  brokerTime.setConnection('connected', '');
  const clock = new BarCountdownClock(brokerTime);
  const first = { symbol: 'XBRUSD', timeMs: Date.parse(quoteTime) };
  brokerTime.acceptQuote(first);
  brokerTime.acceptQuote({ ...first, timeMs: first.timeMs + 1000 });
  return clock.text('XBRUSD', seconds(barStart), wire);
}

// Pinned because the subject is the month-end boundary of leap February 2024 (29 days, not 30).
test('monthly countdown ends at the next month rather than after 30 days', () => {
  expect(countdownText('MN1', '2024-02-01T00:00:00Z', '2024-02-28T23:59:58Z')).toBe('24:00:01');
});

test.describe('bar times of every drawable interval', () => {
  // Every value below is hand-computed from the grid the chart draws.
  const spans: Array<[wire: string, spanSeconds: number]> = [
    ['M7', 420],
    ['S5', 5],
    ['H5', 18000],
    ['D5', 432000],
    ['W2', 1209600],
    ['MN4', 10368000],
    ['M15', 900],
    ['T10', 60],
  ];

  // Intraday bars count from each day's own 00:00, so a length that does not divide a day ends short.
  const barTimes: Array<[wire: string, from: string, offset: number, to: string]> = [
    ['M7', '2024-05-14T23:48:00Z', 1, '2024-05-14T23:55:00Z'],
    ['M7', '2024-05-14T23:48:00Z', 2, '2024-05-15T00:00:00Z'],
    ['M7', '2024-05-14T23:48:00Z', 3, '2024-05-15T00:07:00Z'],
    ['M7', '2024-05-14T23:48:00Z', -1, '2024-05-14T23:41:00Z'],
    ['M7', '2024-05-14T00:00:00Z', 206, '2024-05-15T00:00:00Z'],
    ['M7', '2024-05-14T00:00:00Z', 412, '2024-05-16T00:00:00Z'],
    ['H5', '2024-05-14T20:00:00Z', 1, '2024-05-15T00:00:00Z'],
    ['H5', '2024-05-14T20:00:00Z', 2, '2024-05-15T05:00:00Z'],
    ['S7', '2024-05-14T23:59:54Z', 1, '2024-05-15T00:00:00Z'],
    ['D5', '2024-05-14T00:00:00Z', 1, '2024-05-19T00:00:00Z'],
    ['W2', '2024-01-01T00:00:00Z', 1, '2024-01-15T00:00:00Z'],
    ['MN4', '2024-01-01T00:00:00Z', 1, '2024-05-01T00:00:00Z'],
    ['MN4', '2024-01-01T00:00:00Z', 2, '2024-09-01T00:00:00Z'],
    ['MN4', '2024-01-01T00:00:00Z', -1, '2023-09-01T00:00:00Z'],
    ['M15', '2024-05-14T23:45:00Z', 1, '2024-05-15T00:00:00Z'],
  ];

  const barOffsets: Array<[wire: string, from: string, time: string, offset: number]> = [
    ['M7', '2024-05-14T23:48:00Z', '2024-05-14T23:57:30Z', 1.5],
    ['M7', '2024-05-14T23:48:00Z', '2024-05-15T00:07:00Z', 3],
    ['H5', '2024-05-14T20:00:00Z', '2024-05-14T22:00:00Z', 0.5],
    ['S7', '2024-05-14T23:59:54Z', '2024-05-14T23:59:57Z', 0.5],
    ['MN4', '2024-01-01T00:00:00Z', '2024-03-01T00:00:00Z', 0.5],
    ['MN4', '2024-01-01T00:00:00Z', '2024-05-01T00:00:00Z', 1],
  ];

  test('bar spans cover the drawable codes and unknown codes keep the default', () => {
    for (const [wire, spanSeconds] of spans) {
      expect(timeframeSeconds(wire), wire).toBe(spanSeconds);
    }
  });

  test('bar boundaries step on the grid the bars are drawn on', () => {
    for (const [wire, from, offset, to] of barTimes) {
      expect(timeframeBarTime(wire, seconds(from), offset), `${wire} ${from} ${offset}`).toBe(seconds(to));
    }
  });

  test('bar offsets invert the bar boundaries', () => {
    for (const [wire, from, time, offset] of barOffsets) {
      expect(timeframeBarOffset(wire, seconds(from), seconds(time)), `${wire} ${from} ${time}`).toBe(offset);
    }
  });

  test('future time points step over the short last block of the day', () => {
    const points = futurePoints(seconds('2024-05-14T23:48:00Z'), 'M7', 96, 3);
    expect(points.map((point) => point.time)).toEqual([
      seconds('2024-05-14T23:55:00Z'),
      seconds('2024-05-15T00:00:00Z'),
      seconds('2024-05-15T00:07:00Z'),
    ]);
  });

  test('the countdown of a short last block stops at midnight', () => {
    expect(countdownText('M7', '2024-05-14T23:55:00Z', '2024-05-14T23:56:59Z')).toBe('03:00');
  });
});
