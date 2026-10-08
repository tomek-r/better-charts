import { useRef, useState } from 'react';
import type { ChartController } from '../engine/chartController';
import type { DrawingTool } from '../../tools/toolTypes';
import type { Mt5DataAdapter } from '../engine/mt5DataAdapter';
import type { FixedRangeProfileState } from '../engine/fixedRangeProfileOverlay';
import type { StagedOrderState } from '../engine/stagedOrderOverlay';
import type { PositionOverlayState } from '../engine/positionOverlay';
import type { PriceLinesState } from '../engine/priceLinesOverlay';
import type { PendingModification } from '../../../shared/bridge/types';
import { useChartModificationDrafts } from './useChartModificationDrafts';

export function useChartWorkspace() {
  // Shared (never re-created) state for the FIXED RANGE VOLUME PROFILE: the
  // gesture commits write the fixed range and profile; the painter writes hit
  // geometry (see features/chart/engine/fixedRangeProfileOverlay.ts). Mutate fields only — the
  // plugin captures this object at mount.
  const fixedRangeProfileState = useRef<FixedRangeProfileState>({ range: null, hit: {} });
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
  // dispatch gate and auto-dispatch path through this ref (drag events fire only
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
  // Instrument digits for price normalization inside []-dep chart handlers.
  const instrumentDigitsRef = useRef<number | undefined>(undefined);
  // Fresh staged flag for the []-dep Escape handler (unstage only when staged).
  const stagedActiveRef = useRef(false);
  const expectedProfile = useRef<{ symbol: string; fromMs: number; endMs: number; generation: number } | undefined>(
    undefined,
  );
  const profileGeneration = useRef(0);
  const lastRequestedRangeRef = useRef<{ fromMs: number; endMs: number } | undefined>(undefined);
  const chartHost = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartController | null>(null);
  const adapterRef = useRef<Mt5DataAdapter | null>(null);
  const modifications = useChartModificationDrafts(dragModifyRef);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null);
  return {
    ...modifications,
    fixedRangeProfileState,
    stagedOrderState,
    positionOverlayState,
    priceLinesState,
    dragModifyRef,
    closeActionsRef,
    instrumentDigitsRef,
    stagedActiveRef,
    expectedProfile,
    profileGeneration,
    lastRequestedRangeRef,
    chartHost,
    chart,
    adapterRef,
    drawingTool,
    setDrawingTool,
  };
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspace>;
