import { invoke } from '@tauri-apps/api/core';
import { HISTORY_BARS } from '../../../shared/bridge/limits';
import type { Candle, MarketSnapshot } from '../../../shared/bridge/types';

const HISTORY_TIMEOUT_MS = 10_000;
const HISTORY_TIMEOUT_MESSAGE = 'History request timed out.';
const MAX_BARS = HISTORY_BARS;

/** Numeric values used only at the rendering boundary. Bridge models retain ms and decimal strings. */
export interface RenderBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function toRenderBar(candle: Candle): RenderBar | null {
  const bar = {
    time: Math.floor(candle.timeMs / 1000),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.tickVolume),
  };
  if (
    !Number.isFinite(bar.time) ||
    bar.time <= 0 ||
    !Number.isFinite(bar.open) ||
    bar.open < 0 ||
    !Number.isFinite(bar.high) ||
    bar.high < 0 ||
    !Number.isFinite(bar.low) ||
    bar.low < 0 ||
    !Number.isFinite(bar.close) ||
    bar.close < 0 ||
    !Number.isFinite(bar.volume) ||
    bar.volume < 0 ||
    bar.high < bar.low ||
    bar.high < Math.max(bar.open, bar.close) ||
    bar.low > Math.min(bar.open, bar.close)
  ) {
    return null;
  }
  return bar;
}

export interface Mt5HistoryError {
  message: string;
  symbol: string;
  timeframe: string;
  /** `page` marks a lazy-loading failure, which never surfaces as a chart error. */
  kind: 'dispatch' | 'timeout' | 'page';
}

type HistoryListener = (failure: Mt5HistoryError) => void;
interface PendingHistory {
  symbol: string;
  timeframe: string;
  dispatched: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function clampBars(bars: number): number {
  return Math.min(MAX_BARS, Math.max(1, Math.floor(bars) || MAX_BARS));
}

/** Coordinates one outstanding history request per effective symbol/timeframe selection. */
export class Mt5DataAdapter {
  private pending = new Map<string, PendingHistory>();
  private listeners = new Set<HistoryListener>();
  private disposed = false;
  private selectionGeneration = 0;

  onError(listener: HistoryListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async requestHistory(symbol: string, timeframe: string, bars = MAX_BARS): Promise<void> {
    if (this.disposed) {
      throw new Error('Mt5DataAdapter is disposed.');
    }
    if (!symbol) {
      throw new Error('No symbol selected yet.');
    }
    const key = pendingKey(symbol, timeframe);
    const existing = this.pending.get(key);
    if (existing) {
      return;
    }
    const generation = ++this.selectionGeneration;

    for (const [otherKey, other] of [...this.pending]) {
      if (otherKey !== key) {
        this.settle(otherKey, other);
      }
    }
    const pending = existing ?? (await this.ensurePending(symbol, timeframe));
    if (generation !== this.selectionGeneration) {
      return;
    }
    if (this.pending.get(key) !== pending || pending.dispatched) {
      return;
    }
    pending.dispatched = true;
    if (pending.timer !== undefined) {
      this.armTimeout(key, pending);
    }
    try {
      await invoke('request_history', { symbol, timeframe, bars: clampBars(bars) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.settle(key, pending);
      this.emitError({ message, symbol, timeframe, kind: 'dispatch' });
      throw error;
    }
  }

  /** Called by the single app-level snapshot listener after selection checks. */
  acceptSnapshot(snapshot: MarketSnapshot): void {
    if (this.disposed || !snapshot.symbol || !snapshot.timeframe) {
      return;
    }
    const key = pendingKey(snapshot.symbol, snapshot.timeframe);
    const pending = this.pending.get(key);
    if (pending) {
      this.settle(key, pending);
    }
  }

  /**
   * Requests one page of bars strictly older than `beforeMs`. Keyed apart from
   * the window request and deliberately not part of the selection generation: a
   * page must never block, replace or cancel the history load of the selection
   * it belongs to. Returns without dispatching when a page is already in flight.
   */
  async requestHistoryPage(symbol: string, timeframe: string, bars: number, beforeMs: number): Promise<void> {
    if (this.disposed) {
      throw new Error('Mt5DataAdapter is disposed.');
    }
    if (!symbol) {
      throw new Error('No symbol selected yet.');
    }
    const key = pageKey(symbol, timeframe);
    if (this.pending.has(key)) {
      return;
    }
    const generation = this.selectionGeneration;
    const pending: PendingHistory = { symbol, timeframe, dispatched: true };
    this.pending.set(key, pending);
    this.armTimeout(key, pending, 'page');
    try {
      await invoke('request_history_page', { symbol, timeframe, bars: clampBars(bars), beforeMs });
    } catch (error) {
      this.settle(key, pending);
      if (generation === this.selectionGeneration) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitError({ message, symbol, timeframe, kind: 'page' });
      }
      throw error;
    }
  }

  /** Called by the app-level page listener once a page has been accepted. */
  acceptHistoryPage(symbol: string, timeframe: string): void {
    const key = pageKey(symbol, timeframe);
    const pending = this.pending.get(key);
    if (pending) {
      this.settle(key, pending);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [key, pending] of [...this.pending]) {
      this.settle(key, pending);
    }
    this.listeners.clear();
  }

  resetRequests(): void {
    this.selectionGeneration += 1;
    for (const [key, pending] of [...this.pending]) {
      this.settle(key, pending);
    }
  }

  private async ensurePending(symbol: string, timeframe: string): Promise<PendingHistory> {
    const key = pendingKey(symbol, timeframe);
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }
    const pending: PendingHistory = {
      symbol,
      timeframe,
      dispatched: false,
    };
    this.pending.set(key, pending);
    this.armTimeout(key, pending);
    return pending;
  }

  private armTimeout(key: string, pending: PendingHistory, kind: 'timeout' | 'page' = 'timeout'): void {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pending.timer = setTimeout(() => {
      this.settle(key, pending);
      this.emitError({
        message: HISTORY_TIMEOUT_MESSAGE,
        symbol: pending.symbol,
        timeframe: pending.timeframe,
        kind,
      });
    }, HISTORY_TIMEOUT_MS);
  }

  private settle(key: string, pending: PendingHistory): void {
    if (this.pending.get(key) !== pending) {
      return;
    }
    this.pending.delete(key);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
  }

  private emitError(failure: Mt5HistoryError): void {
    for (const listener of [...this.listeners]) {
      listener(failure);
    }
  }
}

function pendingKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

/** Older-history pages are tracked apart from the selection's window request. */
function pageKey(symbol: string, timeframe: string): string {
  return `${pendingKey(symbol, timeframe)}|older`;
}
