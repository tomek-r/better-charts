import { expect, test } from '@playwright/test';
import { gotoWithStub } from './tauriStub';
import type { Candle } from '../src/shared/bridge/types';

const validCandle: Candle = {
  timeMs: 1_700_000_000_000,
  open: '1.2300',
  high: '1.2400',
  low: '1.2200',
  close: '1.2350',
  tickVolume: 12,
  spread: 2,
  realVolume: 0,
};

test('candle validation matches renderable time and rejects malformed values', async ({ page }) => {
  await gotoWithStub(page);
  const results = await page.evaluate(async (valid) => {
    const normalizersPath = '/src/features/bridge/normalizers.ts';
    const adapterPath = '/src/features/chart/engine/mt5DataAdapter.ts';
    const { isValidCandle } = await import(/* @vite-ignore */ normalizersPath);
    const { toRenderBar } = await import(/* @vite-ignore */ adapterPath);
    const candles = [
      { ...valid, timeMs: 999 },
      { ...valid, timeMs: 1_000 },
      { ...valid, timeMs: Number.NaN },
      { ...valid, open: 'Infinity' },
      { ...valid, high: '1.2299' },
      { ...valid, tickVolume: Number.NaN },
    ];
    return candles.map((candle) => ({ accepted: isValidCandle(candle), renderable: toRenderBar(candle) !== null }));
  }, validCandle);
  expect(results).toEqual(
    [false, true, false, false, false, false].map((accepted) => ({ accepted, renderable: accepted })),
  );
});

test('normalizing a valid candle preserves its exact price strings', async ({ page }) => {
  await gotoWithStub(page);
  const result = await page.evaluate(async (valid) => {
    const normalizersPath = '/src/features/bridge/normalizers.ts';
    const { isValidCandle, normalizeCandle } = await import(/* @vite-ignore */ normalizersPath);
    const candle = normalizeCandle({
      time_ms: valid.timeMs,
      open: valid.open,
      high: valid.high,
      low: valid.low,
      close: valid.close,
      tick_volume: valid.tickVolume,
    });
    return { accepted: isValidCandle(candle), prices: [candle.open, candle.high, candle.low, candle.close] };
  }, validCandle);
  expect(result).toEqual({ accepted: true, prices: ['1.2300', '1.2400', '1.2200', '1.2350'] });
});
