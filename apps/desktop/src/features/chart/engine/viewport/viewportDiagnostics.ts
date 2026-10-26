/**
 * Development-only record of every write to the time scale, for diagnosing a view
 * that moved without the user touching it. The callers gate every use behind
 * `import.meta.env.DEV`, so a production bundle drops this module.
 */

export interface ViewportSnapshot {
  range: { from: number; to: number } | null;
  barCount: number;
  futureCount: number;
  barSpacing: number;
  /** Whether the newest bar is on screen, which is what makes the view follow new bars. */
  following: boolean;
}

export interface ViewportChangeRecord {
  /** The write that ran, e.g. `restoreViewport`. */
  caller: string;
  atMs: number;
  before: ViewportSnapshot;
  after: ViewportSnapshot;
}

/** Enough to cover the minutes before a report without growing unbounded. */
const CAPACITY = 200;
const records: ViewportChangeRecord[] = [];

export function recordViewportChange(caller: string, before: ViewportSnapshot, after: ViewportSnapshot): void {
  records.push({ caller, atMs: Date.now(), before, after });
  if (records.length > CAPACITY) {
    records.shift();
  }
}

/** Plain copies, so a caller cannot rewrite the record. */
export function viewportChangeLog(): ViewportChangeRecord[] {
  return structuredClone(records);
}

export function clearViewportChangeLog(): void {
  records.length = 0;
}
