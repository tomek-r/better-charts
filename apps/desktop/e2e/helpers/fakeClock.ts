/**
 * A clock the spec moves by hand, for Node-run specs of code that schedules timers.
 * `withFakeClock` swaps `setTimeout`, `clearTimeout` and `Date.now` only while its
 * synchronous body runs, so the test runner's own timers are never replaced.
 */
export interface FakeClock {
  /** Moves time forward and runs every timer that falls due, in time order. */
  advance(ms: number): void;
  /** Timers scheduled and not yet run or cleared. */
  pendingTimerCount(): number;
}

export function withFakeClock(body: (clock: FakeClock) => void, startMs = 1_000_000): void {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
  let nowMs = startMs;
  let nextId = 1;
  const timers = new Map<number, { dueMs: number; callback: () => void }>();
  globalThis.setTimeout = ((callback: () => void, delayMs = 0) => {
    const id = nextId++;
    timers.set(id, { dueMs: nowMs + delayMs, callback });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    if (id !== undefined) {
      timers.delete(id);
    }
  }) as unknown as typeof clearTimeout;
  Date.now = () => nowMs;
  const clock: FakeClock = {
    advance(ms) {
      const targetMs = nowMs + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueMs <= targetMs)
          .sort(([, a], [, b]) => a.dueMs - b.dueMs)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        nowMs = due[1].dueMs;
        due[1].callback();
      }
      nowMs = targetMs;
    },
    pendingTimerCount: () => timers.size,
  };
  try {
    body(clock);
  } finally {
    globalThis.setTimeout = real.setTimeout;
    globalThis.clearTimeout = real.clearTimeout;
    Date.now = real.now;
  }
}
