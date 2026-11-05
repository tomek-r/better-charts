import type { SettingInputSource, SettingValues } from '../chart/engine/settings/settingInputs';
import { LENGTH_INPUT, SOURCE_INPUT } from './indicatorInputs';
import { numberSetting, sourceSetting } from './indicatorSettingValues';

/** The settings an indicator's value window is built from: how far it spans, and over which source. */
export interface WindowSettings {
  readonly length: number;
  readonly source: SettingInputSource;
}

/** Reads the `length` and `source` inputs, falling back to `defaults` for the ones not stored. */
export function resolveWindowSettings(settings: SettingValues, defaults: WindowSettings): WindowSettings {
  return {
    length: numberSetting(settings, LENGTH_INPUT, defaults.length),
    source: sourceSetting(settings, SOURCE_INPUT, defaults.source),
  };
}

/** The source values of the newest `size` closed bars, oldest first. */
export class ClosedValueWindow {
  private size = 0;
  private held: number[] = [];

  /** Sets how many closed values the window holds and drops the ones it held. */
  reset(size: number): void {
    this.size = size;
    this.held = [];
  }

  /** Appends a closed value; once the window is full, returns the value it pushed out. */
  push(value: number): number | undefined {
    this.held.push(value);
    if (this.held.length > this.size) {
      return this.held.shift();
    }
    return undefined;
  }

  /** Whether the window already holds every closed value the bar being framed needs. */
  isFull(): boolean {
    return this.held.length === this.size;
  }

  /** The held values, oldest first. */
  values(): readonly number[] {
    return this.held;
  }
}
