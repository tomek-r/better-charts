import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { IndicatorSeriesPage, IndicatorSeriesUnavailable } from '../../../shared/bridge/types';
import type {
  IndicatorSeriesAnswer,
  IndicatorSeriesQuery,
  IndicatorSeriesSource,
} from '../../chart/engine/indicators/indicatorSeriesSource';

type SeriesListener = (answer: IndicatorSeriesAnswer) => void;

/** The listeners of every read in flight, by the key the bridge routes its answer by. */
const listenersByKey = new Map<string, Set<SeriesListener>>();

/** The one registration of the route's two events, shared by every read: the events are global. */
let listening: Promise<void> | null = null;

const UNAVAILABLE: IndicatorSeriesAnswer = { kind: 'unavailable' };

/** Hands `answer` to every read listening for `key`; a read that already left hears nothing. */
function deliver(key: string, answer: IndicatorSeriesAnswer): void {
  for (const listener of [...(listenersByKey.get(key) ?? [])]) {
    listener(answer);
  }
}

/** Registers the series events once, so no request can be written before its answer could be heard. */
function startListening(): Promise<void> {
  listening ??= Promise.all([
    listen<IndicatorSeriesPage>('indicator-series', (event) => {
      const page = event.payload;
      deliver(page.key, {
        kind: 'page',
        beforeMs: page.beforeMs,
        complete: page.complete,
        candles: page.candles,
      });
    }),
    listen<IndicatorSeriesUnavailable>('indicator-series-unavailable', (event) => {
      deliver(event.payload.key, UNAVAILABLE);
    }),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  return listening;
}

/** The command's arguments; Tauri maps their camelCase names onto the command's snake_case parameters. */
function wireQuery(query: IndicatorSeriesQuery, symbol: string): Record<string, unknown> {
  return { key: query.key, symbol, timeframe: query.timeframe, bars: query.bars, beforeMs: query.beforeMs };
}

/**
 * The bridge's read-only series route as an indicator gets it: any timeframe the connected EA advertises, of the
 * symbol the chart shows, answered on the events the command publishes. A refused request is an unread series,
 * which an indicator keeps its last values for rather than asking again.
 */
export function createIndicatorSeriesSource(chartSymbol: () => string | undefined): IndicatorSeriesSource {
  return {
    request: (query) => {
      // A chart that has not resolved its symbol yet has nothing to ask the bridge: the series is simply unread.
      const symbol = chartSymbol();
      if (symbol === undefined) {
        deliver(query.key, UNAVAILABLE);
        return;
      }
      void startListening()
        .then(() => invoke('request_indicator_series', wireQuery(query, symbol)))
        .catch(() => deliver(query.key, UNAVAILABLE));
    },
    subscribe: (key, listener) => {
      void startListening();
      const held = listenersByKey.get(key) ?? new Set<SeriesListener>();
      held.add(listener);
      listenersByKey.set(key, held);
      return () => {
        held.delete(listener);
        if (held.size === 0) {
          listenersByKey.delete(key);
        }
      };
    },
  };
}
