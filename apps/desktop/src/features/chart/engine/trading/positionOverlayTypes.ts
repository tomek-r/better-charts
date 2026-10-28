import type { TradingLabelHit } from './labels/tradingLabelTypes';
import type { RiskSide } from '../../../../shared/bridge/types';
import type { AccountMoneyBasis } from '../../../../shared/money';
import type { TradingHitRect } from './tradingOverlayDrawing';

export interface PositionLine {
  id: string;
  side: RiskSide;
  /** Display string for the label, e.g. "1" (Number-normalized like the library). */
  volume: string;
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Signed money P&L in the ACCOUNT currency (SL/TP money format),
   *  e.g. "+$1.04" / "−$6.63". */
  pnl?: string;
  /** Third segment of the entry tag ("⋮⋮  |  1  |  Market") — the kind shown
   *  while staging; a filled position carries no order type, so App may leave
   *  it unset and the painter falls back to "Market". */
  kindLabel?: string;
  /** Signed money at the exits (account currency) — staged-widget label rule:
   *  SET levels only; undefined keeps the plain "SL"/"TP" handle. */
  slMoney?: string;
  tpMoney?: string;
  /** Partial close is available for this position: the chip paints a ▾ segment after the ✕. */
  partialClose?: boolean;
}

export interface OrderLine {
  id: string;
  side: RiskSide;
  price: number;
  /** Normalized volume string, e.g. "1" (never the raw "1.00000000"). */
  quantity: string;
  /** "LIMIT" | "STOP" | "STOP LIMIT". */
  label: string;
  stopLoss?: number;
  takeProfit?: number;
  /** Signed money at the exits (account currency) — same rule as positions:
   *  set levels only, undefined keeps the plain "SL"/"TP" handle. */
  slMoney?: string;
  tpMoney?: string;
}

/** Which painted line a live drag is attached to; `id` disambiguates. `money`
 *  is the live money label for the dragged level (recomputed per move). */
export interface PositionDrag {
  kind: 'order' | 'sl' | 'tp';
  id: string;
  price: number;
  money?: string;
  /** Effective exit prices while an order-line drag preview is active. */
  exitPreview?: boolean;
  /** These exit prices include a Shift move and must survive a plain re-drag. */
  shiftedExits?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

export interface PositionLineHit {
  id: string;
  y: number;
}
export interface PositionHandleHit extends TradingHitRect {
  id: string;
}
/** ✕ chip hit geometry (the staged drawCancelChip circumscribing circle, r = 10)
 *  recorded per frame for App's capture handlers. */
export interface CancelChipHit {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface PositionOverlayState {
  /** Replace-style sync from the portfolio snapshot (active symbol only). */
  positions: PositionLine[];
  orders: OrderLine[];
  /** Instrument precision mirrored from the active symbol. */
  digits: number;
  /** Money-label basis (account currency) — lets App recompute the dragged
   *  level's money label live; the painter only formats. */
  money?: AccountMoneyBasis;
  /** Live drag preview; cleared by the next sync / drag end. */
  drag: PositionDrag | null;
  /** Fresh geometry every paint; read by the host pointer handlers. */
  hit: {
    labels?: TradingLabelHit[];
    chartRect?: { x: number; y: number; width: number; height: number };
    /** Viewport px → price inverse transform from the last paint (UNCLAMPED,
     *  like the library's yToPrice — a drag may extrapolate past the range). */
    toPrice?: (y: number) => number;
    /** Grabbable lines in chart-frame y: order price first, then SL, then TP
     *  — the exact order TradingDragHandler hit-tested. */
    orderLines?: PositionLineHit[];
    slLines?: PositionLineHit[];
    tpLines?: PositionLineHit[];
    /** Floating SL/TP handles for live positions and orders without a level. */
    slHandles?: PositionHandleHit[];
    tpHandles?: PositionHandleHit[];
    /** ✕ chips: position entry (close) + order price (cancel). Click targets,
     *  dispatched through the same requestClosePosition/requestCancelOrder
     *  flows the portfolio rows use. */
    posCloses?: CancelChipHit[];
    /** ▾ segments after a position's ✕ (only for positions with `partialClose`). */
    posPartials?: CancelChipHit[];
    orderCancels?: CancelChipHit[];
    /** ✕ chips on the SL/TP rows — REMOVE that level (modify with the "0"
     *  sentinel). Ids follow the line convention (`order:` prefix for orders). */
    slClears?: CancelChipHit[];
    tpClears?: CancelChipHit[];
  };
}

/** Hit lists the painter fills every frame; they exist once the pane can be drawn. */
export type PositionHitLists = Required<
  Pick<
    PositionOverlayState['hit'],
    | 'orderLines'
    | 'slLines'
    | 'tpLines'
    | 'slHandles'
    | 'tpHandles'
    | 'posCloses'
    | 'posPartials'
    | 'orderCancels'
    | 'slClears'
    | 'tpClears'
  >
>;

/** Library TradingDragHandler grab tolerance: |y − lineY| ≤ 8 claims the drag. */
export const TRADING_GRAB = 8;
/** Library dragThreshold: vertical px before a claimed grab starts moving. */
export const LINE_DRAG_THRESHOLD = 3;
