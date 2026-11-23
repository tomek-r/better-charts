import type { KeyedReadSource } from '../../chart/engine/indicators/keyedReadSource';
import { readKey } from './readKey';

/**
 * What both reads of the calculation's sources share: the key the host routes their answers by, the one
 * subscription to those answers, and giving both up when the calculation drops the read.
 */
export abstract class LiveKeyedRead<Query, Answer> {
  /** The key the host routes this read's answers by. */
  protected readonly key: string;
  private readonly source: KeyedReadSource<Query, Answer>;
  private listening = false;
  private stopListening: () => void = () => undefined;

  protected constructor(prefix: string, source: KeyedReadSource<Query, Answer>) {
    this.key = readKey(prefix);
    this.source = source;
  }

  /** Stops listening for answers and drops everything the read held. */
  dispose(): void {
    this.stopListening();
    this.listening = false;
    this.stopListening = () => undefined;
    this.dropHeld();
  }

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

  /** Sends `query` to the host; its answer reaches `readAnswer`. */
  protected requestHost(query: Query): void {
    this.source.request(query);
  }
}
