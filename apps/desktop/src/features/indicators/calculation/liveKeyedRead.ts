import type { KeyedReadSource } from '../../chart/engine/indicators/keyedReadSource';
import { readKey } from './readKey';

/** The shortest gap between two live refreshes of a read, so live ticks ask the host at most every two seconds. */
const LIVE_REFRESH_INTERVAL_MS = 2000;

/**
 * What both reads of the calculation's sources share: the key the host routes their answers by, the one
 * subscription to those answers, the throttle the chart's live ticks ask their refreshes under, and giving all
 * of that up when the calculation drops the read.
 */
export abstract class LiveKeyedRead<Query, Answer> {
  /** The key the host routes this read's answers by. */
  protected readonly key: string;
  private readonly source: KeyedReadSource<Query, Answer>;
  private listening = false;
  private stopListening: () => void = () => undefined;
  private requestedAtMs = 0;

  protected constructor(prefix: string, source: KeyedReadSource<Query, Answer>) {
    this.key = readKey(prefix);
    this.source = source;
  }

  /** Asks for what a live tick moved on, at most every two seconds. */
  refreshLive(): void {
    if (Date.now() - this.requestedAtMs < LIVE_REFRESH_INTERVAL_MS) {
      return;
    }
    this.refresh();
  }

  /** Stops listening for answers and drops everything the read held. */
  dispose(): void {
    this.stopListening();
    this.listening = false;
    this.stopListening = () => undefined;
    this.dropHeld();
  }

  /** Asks the host for what the read holds again, once the live throttle lets it through. */
  abstract refresh(): void;

  /** Drops everything the read held, once it stopped listening. */
  protected abstract dropHeld(): void;

  /** Takes one answer from the host: the one the read waits for, or one it asked past. */
  protected abstract readAnswer(answer: Answer): void;

  /** Listens for the answers of this read's key, once, however many reads ask it to. */
  protected listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.stopListening = this.source.subscribe(this.key, (answer) => this.readAnswer(answer));
  }

  /** Sends `query` to the host; the next live refresh is due two seconds from this request. */
  protected requestHost(query: Query): void {
    this.requestedAtMs = Date.now();
    this.source.request(query);
  }
}
