/** A selected plot marks every 10th bar of the pane, as TradingView marks the indicator it has selected. */
const HANDLE_BAR_INTERVAL = 10;

/**
 * The bars the pane shows, as plain indices: placing handles is index arithmetic, so it takes numbers
 * rather than the library's nominal `Logical`.
 */
interface VisibleBarRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The bars a selected plot shows a handle on: one every `HANDLE_BAR_INTERVAL` bars of `range`, counted from
 * its first visible bar, and `lastBarIndex` while it is in view. Empty space left of the data carries none.
 */
export function handleBarIndices(range: VisibleBarRange, lastBarIndex: number | null): number[] {
  const firstVisible = Math.max(0, Math.ceil(range.from));
  const lastVisible = Math.floor(range.to);
  const intervalIndices: number[] = [];
  for (let index = firstVisible; index <= lastVisible; index += HANDLE_BAR_INTERVAL) {
    intervalIndices.push(index);
  }
  if (lastBarIndex === null || lastBarIndex < firstVisible || lastBarIndex > lastVisible) {
    return intervalIndices;
  }
  if (intervalIndices.includes(lastBarIndex)) {
    return intervalIndices;
  }
  return [...intervalIndices, lastBarIndex].sort((first, second) => first - second);
}
