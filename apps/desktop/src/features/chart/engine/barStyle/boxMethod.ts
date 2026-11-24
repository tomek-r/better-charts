/** The ways a box-sized chart type sizes the move that draws its next bar, as TradingView lists them. */
export const BOX_METHODS = ['atr', 'traditional', 'percentageLtp'] as const;

export type BoxMethod = (typeof BOX_METHODS)[number];

export function isBoxMethod(value: unknown): value is BoxMethod {
  return typeof value === 'string' && BOX_METHODS.some((method) => method === value);
}
