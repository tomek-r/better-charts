import { ClosedValueWindow } from '../closedValueWindow';
import { emaAfter, emaValue, INITIAL_EMA_STATE, type EmaState } from '../emaState';

export const SMA_TYPE = 'SMA';
export const EMA_TYPE = 'EMA';

/** A moving average of the bar volumes: the value a forming bar would plot, and the move on a closed one. */
export interface VolumeAverage {
  valueWith(volume: number): number | null;
  commit(volume: number): void;
}

/**
 * The average of the newest `length` volumes, kept as a rolling sum over the newest `length - 1`
 * closed ones: a live tick never enters that window, so a new bar costs one addition and at most
 * one subtraction.
 */
export class SimpleVolumeAverage implements VolumeAverage {
  private readonly window = new ClosedValueWindow();
  private windowSum = 0;

  constructor(private readonly length: number) {
    this.window.reset(length - 1);
  }

  valueWith(volume: number): number | null {
    if (!this.window.isFull()) {
      return null;
    }
    return (this.windowSum + volume) / this.length;
  }

  commit(volume: number): void {
    const dropped = this.window.push(volume);
    this.windowSum += volume;
    if (dropped !== undefined) {
      this.windowSum -= dropped;
    }
  }
}

/**
 * Pine's `ta.ema` over the volumes: the first `length` values seed the average and the weight
 * `2 / (length + 1)` smooths from there. The state stays as of the last closed bar, so a moving
 * tick never changes it.
 */
export class ExponentialVolumeAverage implements VolumeAverage {
  private state: EmaState = INITIAL_EMA_STATE;

  constructor(private readonly length: number) {}

  valueWith(volume: number): number | null {
    return emaValue(emaAfter(this.state, volume, this.length));
  }

  commit(volume: number): void {
    this.state = emaAfter(this.state, volume, this.length);
  }
}

/** The average the chosen type names; anything but `EMA` is read as the simple average. */
export function volumeAverageOf(type: string, length: number): VolumeAverage {
  return type === EMA_TYPE ? new ExponentialVolumeAverage(length) : new SimpleVolumeAverage(length);
}
