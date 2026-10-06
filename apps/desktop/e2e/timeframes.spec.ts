import { test, expect } from '@playwright/test';
import { gotoWithStub, stubInvocations, pushEvent } from './tauriStub';
import { timeframeBarTime, timeframeBarOffset, timeframeLabel } from '../src/shared/bridge/timeframes';
import { futurePoints } from '../src/features/chart/engine/futureTimePoints';
import { BrokerClock } from '../src/features/chart/engine/barCountdown/clock';

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

test('every advertised MT5 period can request history', async ({ page }) => {
  const errors = await gotoWithStub(page);
  const group = page.getByRole('group', { name: 'Chart timeframe' });
  await expect(group.getByRole('button')).toHaveCount(21);
  for (const [wire, label] of periods) {
    await group.getByRole('button', { name: label, exact: true }).click();
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
  await expect(group.getByRole('button')).toHaveText(['1m', '2m', '1M']);
  await pushEvent(page, 'bridge-status', { state: 'connected', supportedTimeframes: ['M1', 'H12', 'W1'] });
  await expect(group.getByRole('button')).toHaveText(['1m', '12H', '1W']);
});

test('all periods fit a narrow chart without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await gotoWithStub(page);
  const group = page.getByRole('group', { name: 'Chart timeframe' });
  await expect(group.getByRole('button')).toHaveCount(21);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

const seconds = (date: string) => Date.parse(date) / 1000;

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

test('monthly countdown ends at the next month rather than after 30 days', () => {
  const clock = new BrokerClock();
  const first = { symbol: 'XBRUSD', timeMs: Date.parse('2024-02-28T23:59:58Z') };
  clock.acceptQuote(first);
  clock.acceptQuote({ ...first, timeMs: first.timeMs + 1000 });
  expect(clock.text('XBRUSD', seconds('2024-02-01T00:00:00Z'), 'MN1')).toBe('24:00:01');
});
