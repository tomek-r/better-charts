import type { RenderBar } from '../chart/engine/bars/renderBar';
import { sourceValue } from '../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../chart/engine/settings/settingInputs';
import { BarByBarIndicator } from './barByBarIndicator';
import type { ClosedAverage } from './closedAverage';
import { resolveWindowSettings } from './closedValueWindow';
import { DEFAULT_LENGTH, DEFAULT_SOURCE, WINDOW_DEFAULTS } from './movingAverageDefaults';

/**
 * An indicator drawing one moving average of its source. SMA and EMA differ only in the average they
 * build, so the walk over the bars lives here once: `valuesAt` draws the forming bar on top of the
 * average's state, and only `commit`, for a bar that closed, moves the average on.
 */
export abstract class ClosedAverageIndicator extends BarByBarIndicator {
  private source: SettingInputSource = DEFAULT_SOURCE;
  // The average a tick draws with before a load has read the settings. Building it here is safe
  // because `averageOf` holds no state: it makes a fresh average of a given length and nothing else.
  private average: ClosedAverage = this.averageOf(DEFAULT_LENGTH);

  /** The average this indicator draws, started over from `length` on every load. */
  protected abstract averageOf(length: number): ClosedAverage;

  protected reset(settings: SettingValues): void {
    const { length, source } = resolveWindowSettings(settings, WINDOW_DEFAULTS);
    this.source = source;
    this.average = this.averageOf(length);
  }

  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    return [this.average.valueWith(sourceValue(bar, this.source))];
  }

  protected commit(bar: RenderBar): void {
    this.average.commit(sourceValue(bar, this.source));
  }
}
