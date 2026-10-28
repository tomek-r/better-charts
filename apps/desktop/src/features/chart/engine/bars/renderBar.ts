import type { Candle } from '../../../../shared/bridge/types';

/** Numeric values used only at the rendering boundary. Bridge models retain ms and decimal strings. */
export interface RenderBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function toRenderBar(candle: Candle): RenderBar | null {
  const bar = {
    time: Math.floor(candle.timeMs / 1000),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.tickVolume),
  };
  if (
    !Number.isFinite(bar.time) ||
    bar.time <= 0 ||
    !Number.isFinite(bar.open) ||
    bar.open < 0 ||
    !Number.isFinite(bar.high) ||
    bar.high < 0 ||
    !Number.isFinite(bar.low) ||
    bar.low < 0 ||
    !Number.isFinite(bar.close) ||
    bar.close < 0 ||
    !Number.isFinite(bar.volume) ||
    bar.volume < 0 ||
    bar.high < bar.low ||
    bar.high < Math.max(bar.open, bar.close) ||
    bar.low > Math.min(bar.open, bar.close)
  ) {
    return null;
  }
  return bar;
}
