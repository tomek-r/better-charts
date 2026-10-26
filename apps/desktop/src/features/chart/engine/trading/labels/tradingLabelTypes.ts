/** Which trading row a label belongs to: its source, its id and the level it labels. */
export interface TradingLabelTarget {
  source: 'trading' | 'staged';
  id: string;
  level: 'entry' | 'sl' | 'tp';
}
export interface TradingLabelHit extends TradingLabelTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Actual price/floating-handle centre, independent of collision spacing. */
  lineY: number;
}

/** Shared frame queue consumed by the trading-labels overlay. */
export interface TradingLabelLayoutState {
  pending: Array<{ target: TradingLabelTarget; y: number; draw: (y: number) => void }>;
}
