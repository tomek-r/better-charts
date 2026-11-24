/** Which prices a point & figure column reads, as TradingView lists them. */
export const POINT_FIGURE_SOURCES = ['highLow', 'close'] as const;

export type PointFigureSource = (typeof POINT_FIGURE_SOURCES)[number];

export function isPointFigureSource(value: unknown): value is PointFigureSource {
  return typeof value === 'string' && POINT_FIGURE_SOURCES.some((source) => source === value);
}
