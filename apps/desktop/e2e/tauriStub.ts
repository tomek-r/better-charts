import { expect, type Page } from '@playwright/test';
import type { BrokerSymbol, Candle } from '../src/shared/bridge/types';

/**
 * Deterministic in-page Tauri v2 stub for execution-flow E2E tests.
 *
 * `installTauriStub` runs via `page.addInitScript` BEFORE any app script loads
 * and provides every `@tauri-apps/api` seam this app touches:
 *
 *  - `window.__TAURI_INTERNALS__.invoke(cmd, args)` — scripted per-command
 *    responses (deep-cloned, no shared state), a full invocation log, and
 *    deterministic rejections via `failures` / unknown-command errors. The
 *    latter rejects instead of resolving `undefined`, but the app catches invoke
 *    rejections into its own error state — an unscripted command surfaces in a
 *    test only where that test asserts the command's UI effect.
 *  - `window.__TAURI_INTERNALS__.transformCallback/unregisterCallback` — the
 *    numeric callback registry behind `listen()`;
 *  - `window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` — required by
 *    `@tauri-apps/api/event`'s `_unlisten` (StrictMode runs effect cleanups, so
 *    this path executes on every test load).
 *
 * Commands whose results the app consumes as bridge EVENTS are handled
 * reactively: the stub pushes the matching event synchronously with payloads
 * echoed from the request args, so the whole draft pipeline runs against the
 * camelCase shapes in `src/shared/bridge/types.ts`:
 *
 *  - `request_risk_preview`  → `risk-preview` event
 *  - `request_order_check`   → `order-check-result` event
 *  - `request_history`       → `market-snapshot` event (feeds the chart adapter)
 *  - `request_history_page`  → `history-page` event (lazy-loaded older candles)
 *
 * Tests push further bridge events (`execution-command-update`,
 * `execution-command-error`, …) with `pushEvent`/`pushCommandUpdate`, which
 * dispatch through the same listener registry `listen()` registered into.
 *
 * No real network or Tauri shell is ever involved.
 */

export interface TauriStubOptions {
  /** Command → JSON-serializable response; merged over the scripted defaults. */
  responses?: Record<string, unknown>;
  /** Command → message; `invoke(cmd)` rejects with `new Error(message)`. */
  failures?: Record<string, string>;
  /** Delay automatic market-snapshot replies to exercise overlapping selection requests. */
  historyDelayMs?: number;
  /** Real timeframe-specific timestamps for chart remapping regressions. */
  historyByTimeframe?: Record<string, Candle[]>;
  /** Optional metadata delivered alongside history, as in the real bridge. */
  symbolInfo?: BrokerSymbol;
  /**
   * Fields merged over the reactive `order-check-result` payload — e.g. a
   * failed check carrying the broker's own `comment`/`retcode`.
   */
  orderCheckResult?: Record<string, unknown>;
  /**
   * Full older-history pages the stub serves before reporting the end of
   * history. Each `request_history_page` returns `pageBars` candles, and every
   * request after this many answers `complete: false` with no candles.
   */
  olderHistoryPages?: number;
  /** Candles per older-history page (default 10, as the deterministic window). */
  olderHistoryBars?: number;
  /**
   * Delay before the `history-page` event, overriding `historyDelayMs`. Lets a
   * test make a page land strictly after a selection change.
   */
  olderHistoryDelayMs?: number;
}

export interface RecordedInvoke {
  cmd: string;
  args: Record<string, unknown>;
}

/** Fixed clock for deterministic stub payloads (rendered times are never asserted). */
export const STUB_NOW = 1745700000000;

/** camelCase payload of `execution-command-update` (mirror of shared/bridge/types.ts). */
export interface CommandUpdateInput {
  commandId?: string;
  status: string;
  retcode?: number | null;
  brokerOrderId?: string | null;
  dealId?: string | null;
  positionId?: string | null;
  filledVolume?: string | null;
  message?: string | null;
  updatedAtMs?: number;
  atUpdate?: number;
}

/** camelCase payload of `execution-command-error` (mirror of shared/bridge/types.ts). */
export interface CommandErrorInput {
  commandId?: string;
  code: string;
  message: string;
}

export async function installTauriStub(page: Page, options: TauriStubOptions = {}): Promise<void> {
  await page.addInitScript((opts: TauriStubOptions) => {
    const w = window as unknown as Record<string, unknown>;
    const NOW = 1745700000000;

    const safety = {
      journalState: 'ready',
      commandCount: 3,
      dispatchEnabled: true,
      message: 'Owner-approved dispatch is active for this session.',
    };

    // Deterministic, valid candles (finite OHLC, high >= low, volume >= 0).
    // Base price PER SYMBOL so tests can see stale data/scales after a symbol
    // switch — EURUSD keeps the exact 1.085 series every existing assertion
    // is pinned to.
    const candlesFor = (symbol: unknown): Array<Record<string, unknown>> => {
      const nasdaq = symbol === 'NAS100';
      const base = nasdaq ? 30432 : 1.085;
      const amplitude = nasdaq ? 4 : 0.0004;
      const digits = nasdaq ? 2 : 4;
      const out: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 10; i += 1) {
        const open = base + Math.sin(i) * amplitude;
        out.push({
          timeMs: NOW - (10 - i) * 300_000,
          open: open.toFixed(digits),
          high: (open + amplitude * 1.75).toFixed(digits),
          low: (open - amplitude * 1.75).toFixed(digits),
          close: (open + amplitude * 0.5).toFixed(digits),
          tickVolume: 120 + i,
          spread: 8,
          realVolume: 120 + i,
        });
      }
      return out;
    };
    const candles = candlesFor('EURUSD');

    /**
     * Older candles for one page: the same deterministic shape walking back from
     * the caller's anchor, so a prepended page is distinguishable from the
     * window by its timestamps alone.
     */
    const olderCandlesFor = (symbol: unknown, beforeMs: number, count: number): unknown[] => {
      const nasdaq = symbol === 'NAS100';
      const base = nasdaq ? 30432 : 1.085;
      const amplitude = nasdaq ? 4 : 0.0004;
      const digits = nasdaq ? 2 : 4;
      const out: Array<Record<string, unknown>> = [];
      for (let i = count; i >= 1; i -= 1) {
        const open = base + Math.sin(i) * amplitude;
        out.push({
          timeMs: beforeMs - i * 300_000,
          open: open.toFixed(digits),
          high: (open + amplitude * 1.75).toFixed(digits),
          low: (open - amplitude * 1.75).toFixed(digits),
          close: (open + amplitude * 0.5).toFixed(digits),
          tickVolume: 120 + i,
          spread: 8,
          realVolume: 120 + i,
        });
      }
      return out;
    };
    /** Pages already served, per symbol+timeframe, so exhaustion is reachable. */
    const pagesServed = new Map<string, number>();

    const responses: Record<string, unknown> = {
      get_app_settings: {
        mt5BridgeSettings: {
          token: 'demo-settings-token',
          address: '127.0.0.1:8765',
          // Mirrors config/bridge.json's default; kept literal so the stub does not
          // inherit the value it is supposed to stand in for.
          maxFrameBytes: 8388608,
          tradingEnabled: false,
          autoStartMt5: false,
          terminalPath: '',
          winePrefix: '',
          wineBinary: '',
          configPath: '',
        },
        configured: true,
        firstLaunch: false,
        restartRequired: false,
        platform: 'linux',
        overriddenKeys: [],
        configurationError: null,
      },
      save_app_settings: 'reactive',
      get_bridge_status: {
        state: 'connected',
        protocolVersion: '2.1',
        supportedTimeframes: [
          'M1',
          'M2',
          'M3',
          'M4',
          'M5',
          'M6',
          'M10',
          'M12',
          'M15',
          'M20',
          'M30',
          'H1',
          'H2',
          'H3',
          'H4',
          'H6',
          'H8',
          'H12',
          'D1',
          'W1',
          'MN1',
        ],
        terminal: 'MetaTrader 5 (demo)',
        account: '50123456',
        server: 'Broker-Demo',
        lastHeartbeat: NOW,
        message: 'Bridge connected — market data is flowing.',
        marketSession: { symbol: 'EURUSD', isOpen: true, tradeMode: 4, serverTimeMs: NOW },
      },
      get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles },
      // No auto-fill race: a fixed quote seeds Entry deterministically (market
      // ticket follows the quote — the price row is disabled for market orders).
      get_quote_snapshot: {
        symbol: 'EURUSD',
        timeMs: NOW,
        bid: '1.0846',
        ask: '1.0850',
        last: '1.0848',
        volume: 10,
        volumeReal: '0',
        flags: 0,
      },
      get_account_snapshot: {
        accountLogin: '50123456',
        brokerServer: 'Broker-Demo',
        accountTradeMode: 0,
        accountTradeModeName: 'demo',
        currency: 'USD',
        balance: '10000.00',
        equity: '10000.00',
        margin: '500.00',
        freeMargin: '9500.00',
        marginLevel: '2000.00',
        leverage: 100,
        marginMode: 2,
        tradeAllowed: true,
        expertAllowed: true,
      },
      get_portfolio_snapshot: { accountLogin: '50123456', capturedAtMs: NOW, positions: [], orders: [] },
      get_execution_safety_status: safety,
      get_reconciliation_status: {
        state: 'complete',
        requestId: 'req-0001',
        snapshotId: 'snap-0001',
        accountLogin: '50123456',
        brokerServer: 'Broker-Demo',
        capturedAtMs: NOW,
        historyFromMs: NOW - 600_000,
        historyToMs: NOW,
        sequenceBefore: 1,
        sequenceAfter: 1,
        positionCount: 0,
        activeOrderCount: 0,
        historyOrderCount: 0,
        historyDealCount: 0,
        message: null,
      },
      get_execution_recovery_snapshot: { safety, entries: [] },
      get_mt5_backend_status: { running: true, configured: true, autoStartEnabled: false },
      get_execution_queue_status: { pending: 0, inFlight: null, dispatchEnabled: true },
      search_symbols: null,
      request_tick_profile: null,
      cancel_tick_profile: null,
      start_mt5_backend: null,
      stop_mt5_backend: null,
      submit_order: null,
      close_position: null,
      cancel_order: null,
      // Not reachable from the UI yet (draft card is chart-event-only), but
      // scripted so the command inventory stays complete.
      modify_order: null,
      // Event-result commands: resolve the invoke AND push the matching event.
      request_risk_preview: 'reactive',
      request_order_check: 'reactive',
      request_history: 'reactive',
      request_history_page: 'reactive',
      ...opts.responses,
    };
    const failures: Record<string, string> = { ...opts.failures };

    const callbacks = new Map<number, (data: unknown) => unknown>();
    const listeners = new Map<string, number[]>();
    const invocations: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    let nextCallbackId = 1;

    function emit(event: string, payload: unknown): void {
      for (const id of [...(listeners.get(event) ?? [])]) {
        const handler = callbacks.get(id);
        // Tauri delivers Event<T> = { event, id, payload }; the app reads payload.
        if (handler) {
          handler({ event, id, payload });
        }
      }
    }

    function transformCallback(callback: (data: unknown) => unknown, once = false): number {
      const id = nextCallbackId;
      nextCallbackId += 1;
      callbacks.set(
        id,
        once
          ? (data) => {
              callbacks.delete(id);
              return callback(data);
            }
          : callback,
      );
      return id;
    }

    function runReactive(cmd: string, args: Record<string, unknown>): null {
      if (cmd === 'request_risk_preview') {
        // Echo = symbol/side/draftVersion/entry/SL/TP only; the figures below are
        // fixed stub values (pipeline coverage, not risk-math).
        emit('risk-preview', {
          symbol: args.symbol,
          side: args.side,
          draftVersion: args.draftVersion,
          entry: args.entry,
          stopLoss: args.stopLoss,
          takeProfit: args.takeProfit,
          riskBudget: '25.00',
          volume: '0.10',
          estimatedRisk: '12.50',
          estimatedReward: '25.00',
          estimatedMargin: '105.00',
          rr: '2.00',
          currency: 'USD',
          quotedAtMs: NOW,
        });
        return null;
      }
      if (cmd === 'request_order_check') {
        emit('order-check-result', {
          draftVersion: args.draftVersion,
          draftId: 'draft-001',
          accountLogin: args.accountLogin,
          brokerServer: args.brokerServer,
          symbol: args.symbol,
          side: args.side,
          orderKind: args.orderKind,
          volume: args.volume,
          requestedEntry: String(args.entry),
          checkPrice: String(args.entry),
          stopLoss: args.stopLoss === null || args.stopLoss === undefined ? null : String(args.stopLoss),
          takeProfit: args.takeProfit === null || args.takeProfit === undefined ? null : String(args.takeProfit),
          limitPrice: args.limitPrice === null || args.limitPrice === undefined ? null : String(args.limitPrice),
          timeInForce: args.timeInForce ?? null,
          checkPassed: true,
          retcode: 10009,
          lastError: 0,
          balance: '10000.00',
          equity: '9987.50',
          profit: '-12.50',
          margin: '105.00',
          freeMargin: '9895.00',
          marginLevel: '9511.90',
          comment: 'Done',
          checkedAtMs: NOW,
          ...opts.orderCheckResult,
        });
        return null;
      }
      if (cmd === 'request_history') {
        const market = responses.get_market_snapshot as {
          symbol?: string;
          timeframe?: string;
          candles?: unknown;
        };
        // Async emit (setTimeout0) models the real bridge: the market-snapshot
        // event lands AFTER invoke resolves, so the pending waiter is still live
        // while the history coordinator is still waiting. Each selection
        // should issue exactly one request_history.
        setTimeout(() => {
          emit('market-snapshot', {
            symbol: args.symbol ?? market.symbol,
            timeframe: args.timeframe ?? market.timeframe,
            complete: true,
            candles:
              opts.historyByTimeframe?.[String(args.timeframe ?? market.timeframe)] ??
              candlesFor(args.symbol ?? market.symbol),
          });
          if (opts.symbolInfo?.symbol === (args.symbol ?? market.symbol)) {
            emit('symbol-info', opts.symbolInfo);
          }
        }, opts.historyDelayMs ?? 0);
        return null;
      }
      if (cmd === 'request_history_page') {
        const beforeMs = Number(args.beforeMs ?? 0);
        const key = `${String(args.symbol)}|${String(args.timeframe)}`;
        const served = pagesServed.get(key) ?? 0;
        const limit = opts.olderHistoryPages ?? 0;
        const bars = opts.olderHistoryBars ?? 10;
        const exhausted = served >= limit;
        pagesServed.set(key, served + 1);
        // Async emit, like request_history: the page lands after invoke resolves.
        setTimeout(
          () => {
            emit('history-page', {
              symbol: args.symbol,
              timeframe: args.timeframe,
              complete: !exhausted,
              beforeMs,
              candles: exhausted ? [] : olderCandlesFor(args.symbol, beforeMs, bars),
            });
          },
          opts.olderHistoryDelayMs ?? opts.historyDelayMs ?? 0,
        );
        return null;
      }
      throw new Error(`E2E Tauri stub: command "${cmd}" marked reactive but has no handler.`);
    }

    async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      invocations.push({ cmd, args });
      if (cmd === 'plugin:event|listen') {
        const id = args.handler as number;
        const registered = listeners.get(args.event as string) ?? [];
        registered.push(id);
        listeners.set(args.event as string, registered);
        return id; // eventId === callback id, like the official @tauri-apps/api mock
      }
      if (cmd === 'plugin:event|unlisten') {
        const registered = listeners.get(args.event as string) ?? [];
        const index = registered.indexOf(args.eventId as number);
        if (index >= 0) {
          registered.splice(index, 1);
        }
        return null;
      }
      if (cmd === 'plugin:event|emit') {
        emit(args.event as string, args.payload);
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(failures, cmd)) {
        throw new Error(failures[cmd]);
      }
      if (!Object.prototype.hasOwnProperty.call(responses, cmd)) {
        throw new Error(`E2E Tauri stub has no scripted response for command "${cmd}".`);
      }
      if (cmd === 'save_app_settings' && responses[cmd] === 'reactive') {
        const view = responses.get_app_settings as Record<string, unknown>;
        const next = {
          ...view,
          mt5BridgeSettings: args.settings,
          configured: true,
          firstLaunch: false,
          restartRequired: true,
        };
        responses.get_app_settings = next;
        return next;
      }
      const scripted = responses[cmd];
      if (scripted === 'reactive') {
        return runReactive(cmd, args);
      }
      const json = JSON.stringify(scripted);
      return json === undefined ? null : JSON.parse(json);
    }

    w.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback,
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => {
        callbacks.delete(id);
      },
    };
    w.__E2E_TAURI_STUB__ = {
      invocations,
      emit,
      listenerCount: (event: string) => (listeners.get(event) ?? []).filter((id) => callbacks.has(id)).length,
    };
  }, options);
}

/** Installs the stub, navigates, and waits for the mounted app. */
export async function gotoWithStub(
  page: Page,
  options: TauriStubOptions = {},
): Promise<{ pageErrors: string[]; consoleErrors: string[] }> {
  await installTauriStub(page, options);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.goto('/');
  await expect(page.locator('main.dashboard')).toBeVisible();
  return { pageErrors, consoleErrors };
}

/** Every recorded `invoke()` (including event-plugin plumbing), oldest first. */
export async function stubInvocations(page: Page): Promise<RecordedInvoke[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __E2E_TAURI_STUB__: { invocations: RecordedInvoke[] } }).__E2E_TAURI_STUB__.invocations,
  );
}

/** First recorded invoke of `cmd`, or undefined if it never ran. */
export async function wasInvoked(page: Page, cmd: string): Promise<RecordedInvoke | undefined> {
  const all = await stubInvocations(page);
  return all.find((entry) => entry.cmd === cmd);
}

/** Pushes a bridge event through the same registry `listen()` wrote into. */
export async function pushEvent(page: Page, event: string, payload: unknown): Promise<void> {
  await page.evaluate(
    (data) => {
      const stub = (window as unknown as { __E2E_TAURI_STUB__: { emit: (name: string, body: unknown) => void } })
        .__E2E_TAURI_STUB__;
      stub.emit(data.event, data.payload);
    },
    { event, payload },
  );
}

/** Pushes an `execution-command-update` event into the app's log-only listener. */
export async function pushCommandUpdate(page: Page, update: CommandUpdateInput): Promise<void> {
  await pushEvent(page, 'execution-command-update', {
    commandId: 'cmd-1001',
    brokerOrderId: null,
    dealId: null,
    positionId: null,
    filledVolume: null,
    message: null,
    retcode: null,
    updatedAtMs: STUB_NOW,
    atUpdate: 1,
    ...update,
  });
}

/** Pushes an `execution-command-error` event (local command error rows/banner). */
export async function pushCommandError(page: Page, error: CommandErrorInput): Promise<void> {
  await pushEvent(page, 'execution-command-error', {
    commandId: 'cmd-1002',
    ...error,
  });
}
