import { ClosedValueWindow } from './closedValueWindow';
import { emaAfter, emaValue, INITIAL_EMA_STATE, type EmaState } from './emaState';

/**
 * A moving average over the values a bar carries: `valueWith` the value a forming bar would plot, and
 * `commit` the move a closed bar makes.
 *
 * The invariant both averages keep: the state stays as of the last closed bar, so a tick never moves it.
 */
export interface ClosedAverage {
  valueWith(value: number): number | null;
  commit(value: number): void;
}

/**
 * The average of the newest `length` values, kept as a rolling sum over the newest `length - 1`
 * closed ones: a live tick never enters that window, so a new bar costs one addition and at most
 * one subtraction.
 */
export class SimpleClosedAverage implements ClosedAverage {
  private readonly window = new ClosedValueWindow();
  private windowSum = 0;

  constructor(private readonly length: number) {
    this.window.reset(length - 1);
  }

  valueWith(value: number): number | null {
    if (!this.window.isFull()) {
      return null;
    }
    return (this.windowSum + value) / this.length;
  }

  commit(value: number): void {
    const dropped = this.window.push(value);
    this.windowSum += value;
    if (dropped !== undefined) {
      this.windowSum -= dropped;
    }
  }
}

/**
 * Pine's `ta.ema`: the first `length` values seed the average and the weight `2 / (length + 1)`
 * smooths from there. The state stays as of the last closed bar, so a moving tick never changes it.
 */
export class ExponentialClosedAverage implements ClosedAverage {
  private state: EmaState = INITIAL_EMA_STATE;

  constructor(private readonly length: number) {}

  valueWith(value: number): number | null {
    return emaValue(emaAfter(this.state, value, this.length));
  }

  commit(value: number): void {
    this.state = emaAfter(this.state, value, this.length);
  }
}
