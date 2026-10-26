import { errorText } from '../../../shared/errorText';
import type { ChartDrawingRecord } from '../engine/drawings/drawingRecord';

/** One backend save: the whole list of one scope, which is what the backend replaces. */
type SaveCall = (records: readonly ChartDrawingRecord[]) => Promise<void>;

/**
 * The saves of one scope, in the order the user made them.
 *
 * While a save is in flight only the newest list waits, and it is sent as soon as that
 * save settles: a burst of edits costs one save per round trip instead of one per edit,
 * and an older list can never overwrite a newer one. A failed save is reported and the
 * waiting list still runs, so one refused write does not lose the edits after it.
 */
export class LatestSaveQueue {
  /** Whether a save is running; further lists wait as `pending` until it settles. */
  private running = false;
  private pending: readonly ChartDrawingRecord[] | undefined;

  constructor(
    private readonly save: SaveCall,
    private readonly onError: (message: string) => void,
  ) {}

  /** Hands `records` to the backend now, or as the next save when one is already running. */
  enqueue(records: readonly ChartDrawingRecord[]): void {
    this.pending = records;
    if (!this.running) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending !== undefined) {
        const records = this.pending;
        this.pending = undefined;
        try {
          await this.save(records);
        } catch (error) {
          this.onError(errorText(error));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
