import { test, expect, type Page } from '@playwright/test';
import { INITIAL_HISTORY_BARS } from '../src/shared/bridge/config';
import { installTauriStub } from './helpers/tauriStub';

interface SnapshotCandle {
  timeMs: number;
  open: string;
  high: string;
  low: string;
}

async function snapshotCandles(page: Page, syntheticBars?: number): Promise<SnapshotCandle[]> {
  await installTauriStub(page, syntheticBars === undefined ? {} : { syntheticBars });
  await page.goto('/');
  return page.evaluate(async () => {
    const internals = window as unknown as {
      __TAURI_INTERNALS__: { invoke(cmd: string): Promise<{ candles: SnapshotCandle[] }> };
    };
    return (await internals.__TAURI_INTERNALS__.invoke('get_market_snapshot')).candles;
  });
}

test('the stub serves 10 candles unless syntheticBars is set', async ({ page }) => {
  expect(await snapshotCandles(page)).toHaveLength(10);
});

test('syntheticBars serves that many valid, strictly increasing candles', async ({ page }) => {
  const candles = await snapshotCandles(page, INITIAL_HISTORY_BARS);
  expect(candles).toHaveLength(INITIAL_HISTORY_BARS);
  for (const [index, candle] of candles.entries()) {
    expect(Number(candle.high)).toBeGreaterThanOrEqual(Number(candle.low));
    if (index > 0) {
      expect(candle.timeMs).toBeGreaterThan(candles[index - 1]!.timeMs);
    }
  }
});
