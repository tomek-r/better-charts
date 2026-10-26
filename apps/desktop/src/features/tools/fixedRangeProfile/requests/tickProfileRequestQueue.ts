import type { ProfileCancelled, ProfileError, ProfileResult } from '../../../../shared/bridge/types';
import type { MarketDataPort, TickProfileRequest, Unsubscribe } from '../../../bridge/marketDataPort';

/** The identity the backend echoes back: which window it computed, whatever the outcome. */
interface TickProfileOutcome {
  symbol: string;
  fromMs: number;
  endMs: number;
}

/** The request the backend is working on and the drawing that asked for it. */
interface InFlightTickProfile {
  readonly ownerId: string;
  readonly request: TickProfileRequest;
  readonly sentAt: number;
}

/** A request a drawing asked for while another one was in flight. */
interface WaitingTickProfile {
  readonly ownerId: string;
  readonly request: TickProfileRequest;
}

/**
 * Safety net with the requester's `LIVE_PROFILE_PENDING_MAX_MS` value and reason: every awaited
 * request ends with a result, an error or a cancellation, so an older in-flight request means its
 * terminal event was lost and must not hold the queue forever. No timer reads this: the cutoff is
 * checked when the next request arrives.
 */
const IN_FLIGHT_SAFETY_MS = 300_000;

/** Whether a terminal event belongs to a request. */
function isOutcomeOf(outcome: TickProfileOutcome, request: TickProfileRequest): boolean {
  return outcome.symbol === request.symbol && outcome.fromMs === request.fromMs && outcome.endMs === request.endMs;
}

/**
 * The backend computes one tick profile at a time and a new request replaces the load in flight, so
 * drawings share this queue: one request is in flight and the others wait their turn. A drawing that
 * re-requests while its own request is in flight is sent at once, which replaces that load exactly
 * as a single drawing did before.
 */
export class TickProfileRequestQueue {
  private inFlight: InFlightTickProfile | null = null;
  private waiting: WaitingTickProfile[] = [];
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly port: MarketDataPort,
    private readonly now: () => number = Date.now,
  ) {
    this.unsubscribe = [
      port.onTickProfile((profile: ProfileResult) => this.finish(profile)),
      port.onTickProfileCancelled((event: ProfileCancelled) => this.finish(event)),
      port.onTickProfileError((event: ProfileError) => this.finish(event)),
    ];
  }

  /**
   * The port of one drawing: a full port, so a requester talks to it as it always talked to the
   * bridge. Its requests go through the queue, its cancel names only its own request, and its
   * subscriptions pass straight to the real port, which sends every event to every drawing.
   */
  portFor(ownerId: string): MarketDataPort {
    return {
      requestTickProfile: (request) => this.enqueue(ownerId, request),
      cancelTickProfile: () => this.cancel(ownerId),
      onTickProfile: (handler) => this.port.onTickProfile(handler),
      onTickProfileCancelled: (handler) => this.port.onTickProfileCancelled(handler),
      onTickProfileError: (handler) => this.port.onTickProfileError(handler),
    };
  }

  /** Drops a waiting request of that drawing: it abandoned locally, so no backend work is cancelled. */
  release(ownerId: string): void {
    this.waiting = this.waiting.filter((entry) => entry.ownerId !== ownerId);
  }

  /**
   * Stops the load in flight: the one backend cancel a reset sends. The next waiting request is not
   * sent, because the caller drops every drawing and calls `clear` next.
   */
  cancelInFlight(): void {
    if (this.inFlight === null) {
      return;
    }
    this.inFlight = null;
    this.port.cancelTickProfile();
  }

  /** Forgets every request without touching the backend: the session's backend state is gone too. */
  clear(): void {
    this.inFlight = null;
    this.waiting = [];
  }

  dispose(): void {
    this.clear();
    for (const release of this.unsubscribe) {
      release();
    }
  }

  private enqueue(ownerId: string, request: TickProfileRequest): void {
    this.forgetLostInFlight();
    if (this.inFlight !== null && this.inFlight.ownerId !== ownerId) {
      this.hold(ownerId, request);
      return;
    }
    this.send(ownerId, request);
  }

  private send(ownerId: string, request: TickProfileRequest): void {
    this.inFlight = { ownerId, request, sentAt: this.now() };
    this.port.requestTickProfile(request);
  }

  /** Queues a request behind the load in flight; a newer request of that drawing replaces its waiting one. */
  private hold(ownerId: string, request: TickProfileRequest): void {
    const queued = this.waiting.findIndex((entry) => entry.ownerId === ownerId);
    if (queued < 0) {
      this.waiting.push({ ownerId, request });
      return;
    }
    this.waiting[queued] = { ownerId, request };
  }

  /**
   * A drawing withdrew its request: a waiting one is only dropped. The load in flight gets a separate
   * backend cancel only when nothing else waits, because a waiting request already replaces the load
   * in flight, and a cancel could reach the backend after that request and stop the wrong load.
   */
  private cancel(ownerId: string): void {
    if (this.inFlight?.ownerId !== ownerId) {
      this.release(ownerId);
      return;
    }
    this.inFlight = null;
    if (this.waiting.length === 0) {
      this.port.cancelTickProfile();
      return;
    }
    this.sendNext();
  }

  /** A terminal event for the load in flight frees the backend for the next waiting request. */
  private finish(outcome: TickProfileOutcome): void {
    if (this.inFlight === null || !isOutcomeOf(outcome, this.inFlight.request)) {
      return;
    }
    this.inFlight = null;
    this.sendNext();
  }

  private sendNext(): void {
    const [next] = this.waiting;
    if (this.inFlight !== null || next === undefined) {
      return;
    }
    this.waiting = this.waiting.slice(1);
    this.send(next.ownerId, next.request);
  }

  private forgetLostInFlight(): void {
    if (this.inFlight !== null && this.now() - this.inFlight.sentAt > IN_FLIGHT_SAFETY_MS) {
      this.inFlight = null;
    }
  }
}
