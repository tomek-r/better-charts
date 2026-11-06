import { MismatchDirection } from 'lightweight-charts';

/** The one series read a value lookup needs: the point a series holds at one logical index. */
interface SeriesPointSource {
  dataByIndex(index: number, mismatchDirection: MismatchDirection): unknown;
}

/** A point that carries a number: its value, and the colour the frame gave it when it gave one. */
export interface NumericSeriesPoint {
  readonly value: number;
  readonly color: string | undefined;
}

/**
 * The point a series holds at one bar, reduced to the number it carries; null where the bar has no
 * point, or its point is whitespace or otherwise without a number.
 */
export function numericPointAt(series: SeriesPointSource, index: number): NumericSeriesPoint | null {
  const point = series.dataByIndex(index, MismatchDirection.None);
  if (point === null || typeof point !== 'object') {
    return null;
  }
  const value = 'value' in point ? point.value : undefined;
  if (typeof value !== 'number') {
    return null;
  }
  return { value, color: colorOf(point) };
}

/** The colour the frame gave one point, when it gave one. */
function colorOf(point: object): string | undefined {
  if ('color' in point && typeof point.color === 'string') {
    return point.color;
  }
  return undefined;
}
