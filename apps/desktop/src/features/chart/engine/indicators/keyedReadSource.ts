/**
 * A read-only host route an indicator reads through: keyed, so that reads in flight never mix up their answers,
 * and closed over whatever reaches a backend. An indicator never reaches a backend itself.
 */
export interface KeyedReadSource<Query, Answer> {
  request(query: Query): void;
  /** Hears every answer for `key` until the returned function runs. */
  subscribe(key: string, listener: (answer: Answer) => void): () => void;
}
