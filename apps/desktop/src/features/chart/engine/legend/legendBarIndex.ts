/**
 * The cached bar index the legend shows for a crosshair logical index.
 *
 * Only a pointer that is over a bar reads that bar, so a null logical index, one before the first
 * bar and one past the last bar all fall back to the last bar (or -1 while there are no bars).
 */
export function legendBarIndex(logical: number | null, barCount: number): number {
  const lastIndex = barCount - 1;
  if (logical === null) {
    return lastIndex;
  }
  const index = Math.round(logical);
  if (index < 0 || index > lastIndex) {
    return lastIndex;
  }
  return index;
}
