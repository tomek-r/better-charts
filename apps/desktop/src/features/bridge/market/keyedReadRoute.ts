import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { KeyedReadSource } from '../../chart/engine/indicators/keyedReadSource';

/** One read-only bridge route: the events it answers on, and the command that asks for a read. */
export interface KeyedReadRoute<Query, Page, Answer> {
  /** The Tauri command that queues one read. */
  readonly command: string;
  /** The event whose payload answers one key. */
  readonly pageEvent: string;
  /** The event whose payload says the route could not read one key. */
  readonly refusalEvent: string;
  /**
   * The symbol this query names itself, when its reads may ask for another symbol than the chart's; a query
   * naming none is read for the chart's own.
   */
  readonly namedSymbol?: (query: Query) => string | undefined;
  /** The read as the command's arguments; Tauri maps their camelCase names onto its snake_case parameters. */
  readonly wireArgs: (query: Query, symbol: string) => Record<string, unknown>;
  /** The host's page as the read that asked for it hears it. */
  readonly answerOf: (page: Page) => Answer;
  /** What a refused read hears: the values it holds stay, and nothing asks again on its own. */
  readonly refusal: Answer;
}

type RouteListener<Answer> = (answer: Answer) => void;

/**
 * A keyed route as an indicator gets it: each read hears only the answers of the key it asked under, so several
 * reads can be in flight at once, and a read asking for the chart's symbol before the chart resolved it is
 * simply unread.
 */
export function createKeyedReadSource<Query extends { key: string }, Page extends { key: string }, Answer>(
  route: KeyedReadRoute<Query, Page, Answer>,
  chartSymbol: () => string | undefined,
): KeyedReadSource<Query, Answer> {
  /** The listeners of every read in flight, by the key the host routes its answer by. */
  const listenersByKey = new Map<string, Set<RouteListener<Answer>>>();
  /** The one registration of the route's two events, shared by every read: the events are global. */
  let listening: Promise<void> | null = null;

  /** Hands `answer` to every read listening for `key`; a read that already left hears nothing. */
  function deliver(key: string, answer: Answer): void {
    for (const listener of [...(listenersByKey.get(key) ?? [])]) {
      listener(answer);
    }
  }

  /** Registers the route's events once, so no request can be written before its answer could be heard. */
  function startListening(): Promise<void> {
    listening ??= Promise.all([
      listen<Page>(route.pageEvent, (event) => deliver(event.payload.key, route.answerOf(event.payload))),
      listen<{ key: string }>(route.refusalEvent, (event) => deliver(event.payload.key, route.refusal)),
    ])
      .then(() => undefined)
      .catch(() => undefined);
    return listening;
  }

  return {
    request: (query) => {
      // A read that names its own symbol asks for it even before the chart has resolved its own.
      const symbol = route.namedSymbol?.(query) ?? chartSymbol();
      if (symbol === undefined) {
        deliver(query.key, route.refusal);
        return;
      }
      void startListening()
        .then(() => invoke(route.command, route.wireArgs(query, symbol)))
        .catch(() => deliver(query.key, route.refusal));
    },
    subscribe: (key, listener) => {
      void startListening();
      const held = listenersByKey.get(key) ?? new Set<RouteListener<Answer>>();
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
