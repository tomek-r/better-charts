import { ExponentialClosedAverage, SimpleClosedAverage, type ClosedAverage } from '../closedAverage';

export const SMA_TYPE = 'SMA';
export const EMA_TYPE = 'EMA';

/** The average the chosen type names; anything but `EMA` is read as the simple average. */
export function volumeAverageOf(type: string, length: number): ClosedAverage {
  return type === EMA_TYPE ? new ExponentialClosedAverage(length) : new SimpleClosedAverage(length);
}
