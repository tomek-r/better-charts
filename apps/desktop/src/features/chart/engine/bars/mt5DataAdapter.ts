import { HISTORY_BARS, INITIAL_HISTORY_SYNC_TIMEOUT_MS } from '../../../../shared/bridge/config';
import type { MarketSnapshot } from '../../../../shared/bridge/types';
import { errorText } from '../../../../shared/errorText';

/** Older pages wait for the EA's own page deadline (BRIDGE_HISTORY_PAGE_DEADLINE_MS). */
const PAGE_TIMEOUT_MS = 10_000;
/**
 * The EA answers an unsynchronized window with a correlated error at its
 * deadline; this timeout only has to outlast that answer and its transport,
 * and still ends the wait if the EA never answers at all.
 */
const WINDOW_ANSWER_GRACE_MS = 2_000;
const WINDOW_TIMEOUT_MS = INITIAL_HISTORY_SYNC_TIMEOUT_MS + WINDOW_ANSWER_GRACE_MS;
const HISTORY_TIMEOUT_MESSAGE = 'History request timed out.';

export interface Mt5HistoryError {
  message: string;
  symbol: string;
  timeframe: string;
  /** `page` marks a lazy-loading failure, which never surfaces as a chart error. */
  kind: 'dispatch' | 'timeout' | 'page';
}

/** How the adapter reaches the bridge; the engine never knows what carries the requests. */
export interface HistoryTransport {
  requestHistory(request: { symbol: string; timeframe: string; bars: number }): Promise<unknown>;
  requestHistoryPage(request: { symbol: string; timeframe: string; bars: number; beforeMs: number }): Promise<unknown>;
}

type HistoryListener = (failure: Mt5HistoryError) => void;
interface PendingHistory {
  symbol: string;
  timeframe: string;
  dispatched: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function clampBars(bars: number): number {
  return Math.min(HISTORY_BARS, Math.max(1, Math.floor(bars) || HISTORY_BARS));
}

function pendingKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

/** Older-history pages are tracked apart from the selection's window request. */
function pageKey(symbol: string, timeframe: string): string {
  return `${pendingKey(symbol, timeframe)}|older`;
}

/** Coordinates one outstanding history request per effective symbol/timeframe selection. */
export class Mt5DataAdapter {
  private pending = new Map<string, PendingHistory>();
  private listeners = new Set<HistoryListener>();
  private disposed = false;
  private selectionGeneration = 0;

  constructor(private readonly transport: HistoryTransport) {}

  onError(listener: HistoryListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async requestHistory(symbol: string, timeframe: string, bars = HISTORY_BARS): Promise<void> {
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

    this.settleAll(key);
    const pending: PendingHistory = {
      symbol,
      timeframe,
      dispatched: false,
    };
    this.pending.set(key, pending);
    this.startTimeout(key, pending);

    // Let same-turn symbol/timeframe changes settle before dispatching history.
    await Promise.resolve();
    if (generation !== this.selectionGeneration) {
      return;
    }
    if (this.pending.get(key) !== pending || pending.dispatched) {
      return;
    }
    pending.dispatched = true;
    if (pending.timer !== undefined) {
      this.startTimeout(key, pending);
    }
    try {
      await this.transport.requestHistory({ symbol, timeframe, bars: clampBars(bars) });
    } catch (error) {
      const message = errorText(error);
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
    this.settleKey(pendingKey(snapshot.symbol, snapshot.timeframe));
  }

  /** Called when the EA reports it could not synchronize the awaited window; nothing more will arrive. */
  acceptHistoryUnavailable(symbol: string, timeframe: string): void {
    this.settleKey(pendingKey(symbol, timeframe));
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
    this.startTimeout(key, pending, 'page');
    try {
      await this.transport.requestHistoryPage({ symbol, timeframe, bars: clampBars(bars), beforeMs });
    } catch (error) {
      this.settle(key, pending);
      if (generation === this.selectionGeneration) {
        const message = errorText(error);
        this.emitError({ message, symbol, timeframe, kind: 'page' });
      }
      throw error;
    }
  }

  /** Called by the app-level page listener once a page has been accepted. */
  acceptHistoryPage(symbol: string, timeframe: string): void {
    this.settleKey(pageKey(symbol, timeframe));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.settleAll();
    this.listeners.clear();
  }

  resetRequests(): void {
    this.selectionGeneration += 1;
    this.settleAll();
  }

  private startTimeout(key: string, pending: PendingHistory, kind: 'timeout' | 'page' = 'timeout'): void {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    const timeoutMs = kind === 'page' ? PAGE_TIMEOUT_MS : WINDOW_TIMEOUT_MS;
    pending.timer = setTimeout(() => {
      this.settle(key, pending);
      this.emitError({
        message: HISTORY_TIMEOUT_MESSAGE,
        symbol: pending.symbol,
        timeframe: pending.timeframe,
        kind,
      });
    }, timeoutMs);
  }

  /** Settles every outstanding request, except the one under `keptKey` when given. */
  private settleAll(keptKey?: string): void {
    for (const [key, pending] of [...this.pending]) {
      if (key !== keptKey) {
        this.settle(key, pending);
      }
    }
  }

  private settleKey(key: string): void {
    const pending = this.pending.get(key);
    if (pending) {
      this.settle(key, pending);
    }
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
