import { useEffect } from 'react';
import { ticketPrice } from '../../shared/format';
import type { ChartWorkspaceState } from './useChartWorkspace';

export function useChartGestureDiagnostics(workspace: ChartWorkspaceState): void {
  const { chartHost, stagedOrderState, positionOverlayState, priceLinesState, fixedRangeProfileState, chart } =
    workspace;

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    type Api = {
      geometry: () => Record<string, unknown> | null;
      expectedPrice: (clientY: number) => string | null;
      fixedRangeProfile: () => { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
      realTrading: () => Record<string, unknown> | null;
    };
    const api: Api = {
      realTrading: () => {
        const rect = chartHost.current?.getBoundingClientRect();
        if (!rect) {
          return null;
        }
        const hit = positionOverlayState.current.hit;
        const chips = (rows: Array<{ id: string; x: number; y: number; r: number }> = []) =>
          rows.map((row) => ({ ...row, x: row.x + rect.left, y: row.y + rect.top }));
        const lines = (rows: Array<{ id: string; y: number }> = []) =>
          rows.map((row) => ({ ...row, y: row.y + rect.top }));
        return {
          labels: (hit.labels ?? []).map((row) => ({
            ...row,
            x: row.x + rect.left,
            y: row.y + rect.top,
            lineY: row.lineY + rect.top,
          })),
          posCloses: chips(hit.posCloses),
          orderCancels: chips(hit.orderCancels),
          slLines: lines(hit.slLines),
          tpLines: lines(hit.tpLines),
          orderLines: lines(hit.orderLines),
        };
      },
      geometry: () => {
        const host = chartHost.current;
        const rect = host?.getBoundingClientRect();
        if (!rect) {
          return null;
        }
        const state = stagedOrderState.current;
        const hit = state.hit;
        const viewport = chart.current?.diagnosticViewport();
        const circle = (c: { x: number; y: number; r: number } | undefined) =>
          c ? { x: rect.left + c.x, y: rect.top + c.y, r: c.r } : null;
        const box = (b: { x: number; y: number; w: number; h: number } | undefined) =>
          b ? { x: rect.left + b.x, y: rect.top + b.y, w: b.w, h: b.h } : null;
        return {
          staged: state.order !== null,
          container: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          entryLineY: hit.entryLineY !== undefined ? rect.top + hit.entryLineY : null,
          entryCancel: circle(hit.entryCancel),
          slCancel: circle(hit.slCancel),
          tpCancel: circle(hit.tpCancel),
          slHandle: box(hit.slHandle),
          tpHandle: box(hit.tpHandle),
          volume: state.order?.volume ?? null,
          slMoney: state.order?.slMoney ?? null,
          tpMoney: state.order?.tpMoney ?? null,
          riskRewardLabel: state.order?.riskRewardLabel ?? null,
          chartRect: hit.chartRect
            ? {
                x: rect.left + hit.chartRect.x,
                y: rect.top + hit.chartRect.y,
                width: hit.chartRect.width,
                height: hit.chartRect.height,
              }
            : null,
          visibleRange: hit.visibleRange ?? null,
          priceRange: hit.priceRange ?? null,
          barSpacing: hit.barSpacing ?? null,
          barWidth: hit.barWidth ?? null,
          digits: state.digits,
          // Panning geometry (for E2E gestures): where the viewport is, where
          // scrollToEnd would land it, and whether follow-on-new-bar is armed.
          offset: viewport?.offset ?? null,
          endAnchor: viewport?.endAnchor ?? null,
          followArmed: viewport?.followArmed ?? null,
          askY: priceLinesState.current.hit.askY !== undefined ? rect.top + priceLinesState.current.hit.askY : null,
          bidY: priceLinesState.current.hit.bidY !== undefined ? rect.top + priceLinesState.current.hit.bidY : null,
        };
      },
      // Same clamp -> transform -> round chain applyDrag uses, so the expected
      // ticket value for a drop at clientY is exact, not approximate.
      expectedPrice: (clientY) => {
        const host = chartHost.current;
        const rect = host?.getBoundingClientRect();
        const hit = stagedOrderState.current.hit;
        if (!rect || !hit.chartRect || !hit.toPrice) {
          return null;
        }
        const y = Math.min(Math.max(clientY - rect.top, hit.chartRect.y), hit.chartRect.y + hit.chartRect.height);
        const price = hit.toPrice(y);
        return Number.isFinite(price) && price > 0 ? ticketPrice(price, stagedOrderState.current.digits) : null;
      },
      // FRVP lifecycle surface for the E2E: the active fixed-range selection
      // (null = cleared) plus whether its computed profile is loaded — proves
      // the selection survives a timeframe switch and dies on a symbol switch.
      fixedRangeProfile: () => {
        const range = fixedRangeProfileState.current.range;
        return {
          range: range ? { fromMs: range.fromMs, toMs: range.toMs } : null,
          hasProfile:
            fixedRangeProfileState.current.profile !== undefined && !fixedRangeProfileState.current.previewing,
        };
      },
    };
    (window as unknown as { __stagedWidgetTest?: Api }).__stagedWidgetTest = api;
    return () => {
      delete (window as unknown as { __stagedWidgetTest?: Api }).__stagedWidgetTest;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, []);
}
