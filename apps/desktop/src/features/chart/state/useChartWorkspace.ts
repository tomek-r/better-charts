import { useRef, useState } from 'react';
import type { ChartController } from '../engine/chartController';
import { DEFAULT_CHART_TOOL_ID, type ChartToolId } from '../../tools/registry';
import type { Mt5DataAdapter } from '../engine/mt5DataAdapter';
import type { StagedOrderState } from '../engine/stagedOrderOverlay';
import type { PositionOverlayState } from '../engine/positionOverlay';
import type { PartialCloseChipPort } from '../engine/partialCloseChipPort';
import type { PriceLinesState } from '../engine/priceLinesOverlay';
import type { PendingModification } from '../../../shared/bridge/types';
import { useChartModificationDrafts } from './useChartModificationDrafts';

export function useChartWorkspace() {
  // Shared (never re-created) state for the staged-order widget overlay: the
  // renderer writes hit geometry every frame; App's mirror effect writes the
  // ticket values; the host pointer handlers read both. No polling, no chart
  // internals — see features/chart/engine/stagedOrderOverlay.ts for the mechanism contract.
  const stagedOrderState = useRef<StagedOrderState>({ order: null, digits: 2, hit: {} });
  // Shared (never re-created) state for OUR position/order overlay: the painter
  // writes hit geometry every frame; the sync effect writes the portfolio
  // lines; the host pointer handlers read both — see features/chart/engine/positionOverlay.ts.
  const positionOverlayState = useRef<PositionOverlayState>({
    positions: [],
    orders: [],
    digits: 2,
    drag: null,
    hit: {},
  });
  // Live bid/ask price lines overlay state — the quote effect writes the
  // prices, the painter writes hit geometry (see features/chart/engine/priceLinesOverlay.ts).
  const priceLinesState = useRef<PriceLinesState>({ digits: 2, hit: {} });
  // The chart SL/TP drag handlers bind once at mount; they read this render's
  // dispatch gate and auto-dispatch path through this ref (drag events arrive only
  // after a commit, so the stored closure always carries fresh state).
  const dragModifyRef = useRef<{ enabled: boolean; dispatch: (draft: PendingModification) => void } | undefined>(
    undefined,
  );
  // Fresh ✕ dispatchers for the custom overlay's close/cancel chips: the
  // capture handlers mount once, but requestClosePosition/requestCancelOrder
  // close over account/closingTarget state — same ref pattern as dragModifyRef.
  const closeActionsRef = useRef<
    { close: (positionId: string) => void; cancel: (orderId: string) => void } | undefined
  >(undefined);
  // The DOM host of the partial-close menu registers itself here so the painted
  // ▾ chip (engine) can open it without importing React.
  const partialCloseChipPortRef = useRef<PartialCloseChipPort | undefined>(undefined);
  // Instrument digits for price normalization inside []-dep chart handlers.
  const instrumentDigitsRef = useRef<number | undefined>(undefined);
  // Fresh staged flag for the []-dep Escape handler (unstage only when staged).
  const stagedActiveRef = useRef(false);
  const chartHost = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartController | null>(null);
  const adapterRef = useRef<Mt5DataAdapter | null>(null);
  const modifications = useChartModificationDrafts(dragModifyRef);
  const [activeChartToolId, selectChartTool] = useState<ChartToolId>(DEFAULT_CHART_TOOL_ID);
  return {
    ...modifications,
    stagedOrderState,
    positionOverlayState,
    priceLinesState,
    dragModifyRef,
    closeActionsRef,
    partialCloseChipPortRef,
    instrumentDigitsRef,
    stagedActiveRef,
    chartHost,
    chart,
    adapterRef,
    activeChartToolId,
    selectChartTool,
  };
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspace>;
