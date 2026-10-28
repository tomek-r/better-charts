import type { ChartController } from '../surface/chartController';
import type { PartialCloseChipPort } from './partialCloseChipPort';
import type { PositionOverlayState } from './positionOverlayTypes';
import type { StagedOrderState } from './stagedOrderOverlay';

/** A mutable cell the chart host owns; the gestures only read `current`. */
type SharedCell<Value> = { readonly current: Value };

/** What the staged-order gestures need from the chart workspace. */
export type StagedGestureWorkspace = {
  readonly stagedOrderState: SharedCell<StagedOrderState>;
  readonly chart?: SharedCell<ChartController | null>;
};

/** What the position/order overlay gestures need from the chart workspace. */
export type TradingGestureWorkspace = {
  readonly positionOverlayState: SharedCell<PositionOverlayState>;
  readonly chart: SharedCell<ChartController | null>;
  readonly applyOrderModify: (payload: {
    orderId: string;
    newPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    autoDispatch: boolean;
  }) => void;
  readonly applyOrderLevelModify: (payload: { orderId: string; stopLoss?: number; takeProfit?: number }) => void;
  readonly applyPositionModify: (payload: { positionId: string; stopLoss?: number; takeProfit?: number }) => void;
  readonly applyLevelClear: (level: 'sl' | 'tp', targetKey: string) => void;
  readonly closeActionsRef: SharedCell<
    { close: (positionId: string) => void; cancel: (orderId: string) => void } | undefined
  >;
  readonly partialCloseChipPortRef: SharedCell<PartialCloseChipPort | undefined>;
};
