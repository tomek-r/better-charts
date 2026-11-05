import { expect } from '@playwright/test';

import type { RenderBar } from '../../src/features/chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../src/features/chart/engine/indicators/indicatorContract';
import type { SettingValues } from '../../src/features/chart/engine/settings/settingInputs';

/**
 * The live contract every bar-by-bar indicator keeps: once `history` is loaded, a newer bar returns the
 * bar it closed, confirmed, and then itself, still forming.
 */
export function expectNewerBarClosesTheFormingOne(
  indicator: ChartIndicator,
  history: readonly RenderBar[],
  settings: SettingValues,
): void {
  const closedBar = history[history.length - 1];
  const nextBar = barAt(history.length, (closedBar?.close ?? 0) + 1);
  indicator.load(history, settings);

  const frame = indicator.update(nextBar, settings);

  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, false]);
  expect(frame.bars.map((bar) => bar.timeMs)).toEqual(
    [closedBar, nextBar].map((bar) => (bar?.time ?? 0) * MILLISECONDS_PER_SECOND),
  );
}

export const FIRST_BAR_TIME = 1_700_000_000;
export const BAR_SPACING_SECONDS = 300;
export const MILLISECONDS_PER_SECOND = 1000;

/** A bar one `BAR_SPACING_SECONDS` later than the bar before it, so its index also dates it. */
export function barAt(index: number, close: number, high = close, low = close): RenderBar {
  return {
    time: FIRST_BAR_TIME + index * BAR_SPACING_SECONDS,
    open: close,
    high,
    low,
    close,
    volume: 0,
  };
}

/** One bar per close, in the order the closes are given. */
export function barsFromCloses(closes: readonly number[]): RenderBar[] {
  return closes.map((close, index) => barAt(index, close));
}
