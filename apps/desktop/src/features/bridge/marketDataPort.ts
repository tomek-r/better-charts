import { invoke } from '@tauri-apps/api/core';
import type { ProfileCancelled, ProfileError, ProfileResult } from '../../shared/bridge/types';
import { errorText } from '../../shared/errorText';

/** A bounded tick-profile request: the window `[fromMs, endMs)` of one symbol. */
export interface TickProfileRequest {
  symbol: string;
  fromMs: number;
  endMs: number;
  rows: number;
}

export type Unsubscribe = () => void;

/**
 * The only door a chart tool has to the bridge: an allow-list of read-only market
 * data requests and result events. It is deliberately narrow and has no generic
 * `invoke`. Chart tools must never reach execution commands (orders, dispatch,
 * modification, close), which is why a tool receives this port and never the Tauri
 * `invoke`/`listen` functions. Extend it with another read-only data kind only.
 */
export interface MarketDataPort {
  requestTickProfile(request: TickProfileRequest): void;
  cancelTickProfile(): void;
  onTickProfile(handler: (profile: ProfileResult) => void): Unsubscribe;
  onTickProfileCancelled(handler: (event: ProfileCancelled) => void): Unsubscribe;
  onTickProfileError(handler: (event: ProfileError) => void): Unsubscribe;
}

/** The bridge-side publisher: the market runtime forwards events it accepted into the port. */
export interface MarketDataPublisher {
  publishTickProfile(profile: ProfileResult): void;
  publishTickProfileCancelled(event: ProfileCancelled): void;
  publishTickProfileError(event: ProfileError): void;
}

export interface MarketDataConnection {
  port: MarketDataPort;
  publisher: MarketDataPublisher;
}

function createEventChannel<T>() {
  const handlers = new Set<(value: T) => void>();
  return {
    subscribe(handler: (value: T) => void): Unsubscribe {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    publish(value: T): void {
      for (const handler of [...handlers]) {
        handler(value);
      }
    },
  };
}

/** One long-lived instance per bridge session; it outlives the market runtime's effect runs. */
export function createMarketDataConnection(): MarketDataConnection {
  const profile = createEventChannel<ProfileResult>();
  const cancelled = createEventChannel<ProfileCancelled>();
  const failed = createEventChannel<ProfileError>();
  return {
    port: {
      requestTickProfile: ({ symbol, fromMs, endMs, rows }) => {
        // A rejected command never produces a backend event, so the requester would wait
        // forever: report it as the same error event a backend failure would send.
        invoke('request_tick_profile', { symbol, fromMs, endMs, rows }).catch((reason: unknown) => {
          failed.publish({
            symbol,
            fromMs,
            endMs,
            message: `Volume profile request failed: ${errorText(reason)}`,
          });
        });
      },
      // Silent on failure by design: a cancel names no request, so there is no
      // `ProfileError` to attribute; the tool has already abandoned the request locally.
      cancelTickProfile: () => {
        void invoke('cancel_tick_profile').catch(() => undefined);
      },
      onTickProfile: profile.subscribe,
      onTickProfileCancelled: cancelled.subscribe,
      onTickProfileError: failed.subscribe,
    },
    publisher: {
      publishTickProfile: profile.publish,
      publishTickProfileCancelled: cancelled.publish,
      publishTickProfileError: failed.publish,
    },
  };
}
