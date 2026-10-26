import type { Candle } from '../../../../shared/bridge/types';

/** Longest candles wait for a pointer release before the chart takes them anyway. */
const MAX_HOLD_MS = 10_000;

/**
 * Holds live candles back while a pointer is pressed on the pane.
 *
 * The library scrolls a pressed pane from the offset it saw at the press. A bar
 * appended meanwhile moves its right edge by a whole bar, which that scroll never
 * learns about, so the next pointer move would shift the bars under the pointer.
 * Candles wait for the release and are then applied in arrival order.
 */
export class PointerCandleHold {
  private pressStartedAtMs: number | null = null;
  private readonly held: Candle[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly apply: (candle: Candle) => void,
  ) {
    host.addEventListener('pointerdown', this.onPress, { capture: true });
    window.addEventListener('pointerup', this.onRelease, { capture: true });
    window.addEventListener('pointercancel', this.onRelease, { capture: true });
    window.addEventListener('blur', this.onRelease);
  }

  /** Keeps the candle for the release and returns true while a pointer is pressed; false means apply it now. */
  hold(candle: Candle): boolean {
    if (!this.isPressed()) {
      this.applyHeld();
      return false;
    }
    this.held.push(candle);
    return true;
  }

  /** Drops what was held, for candles that belong to a history that was replaced. */
  discard(): void {
    this.held.length = 0;
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.onPress, { capture: true });
    window.removeEventListener('pointerup', this.onRelease, { capture: true });
    window.removeEventListener('pointercancel', this.onRelease, { capture: true });
    window.removeEventListener('blur', this.onRelease);
    this.discard();
  }

  /**
   * A press whose release never arrives (focus lost to a dialog, a lost event)
   * must not freeze the chart, so a hold ends after `MAX_HOLD_MS` anyway.
   */
  private isPressed(): boolean {
    if (this.pressStartedAtMs === null) {
      return false;
    }
    if (Date.now() - this.pressStartedAtMs > MAX_HOLD_MS) {
      this.pressStartedAtMs = null;
      return false;
    }
    return true;
  }

  // Only a primary-button press scrolls the pane; a right-click opens a menu that swallows its release.
  private readonly onPress = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.pressStartedAtMs = Date.now();
  };

  private readonly onRelease = (): void => {
    this.pressStartedAtMs = null;
    this.applyHeld();
  };

  private applyHeld(): void {
    for (const candle of this.held.splice(0)) {
      this.apply(candle);
    }
  }
}
