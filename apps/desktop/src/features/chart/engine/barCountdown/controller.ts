import type { BridgeState, QuoteSnapshot } from '../../../../shared/bridge/types';
import type { BarCountdownPrimitive } from './primitive';
import type { BarCountdownState } from './types';
import { DEFAULT_TIMEFRAME } from '../../../../shared/bridge/timeframes';

/**
 * The live inputs the countdown mirrors, read at each sync so the controller
 * keeps the single copy of each one.
 */
export interface CountdownInputs {
  symbol(): string;
  timeframe(): string;
  barTimeSeconds(): number | undefined;
  bid(): number | undefined;
  ask(): number | undefined;
}

/**
 * Owns the countdown's state: the mirrored chart inputs, the connection identity
 * and the last quote, plus the primitive that paints the axis tag and owns the
 * broker clock.
 *
 * Every input has exactly one owner, and this object is the one place that
 * collects them, because the tag silently goes stale if any caller forgets to
 * push an update after changing one.
 *
 * `setQuote` and `setPending` sync themselves, but `setConnection` only records.
 * Its caller writes the connection flag, then the chrome that labels it, and
 * syncs once afterwards, so the tag never repaints from a half-updated
 * connection state. Calling it without syncing leaves the state saying
 * disconnected while the chrome says connected, and the tag renders blank.
 *
 * The primitive stays with the controller for attach and detach, and is handed
 * in here only to be updated.
 */
export class CountdownController {
  private readonly state: BarCountdownState = {
    symbol: '',
    timeframe: DEFAULT_TIMEFRAME,
    connected: false,
    suspended: false,
    connectionIdentity: '',
  };
  private quote?: QuoteSnapshot;

  constructor(
    private readonly primitive: BarCountdownPrimitive,
    private readonly inputs: CountdownInputs,
  ) {}

  setQuote(quote?: QuoteSnapshot): void {
    this.quote = quote;
    this.sync();
  }

  setPending(pending: boolean): void {
    this.state.suspended = pending;
    this.sync();
  }

  setConnection(state: BridgeState, identity: string): void {
    this.state.connected = state === 'connected';
    this.state.connectionIdentity = identity;
  }

  /** Mirrors every input into the countdown state and repaints the axis tag. */
  sync(): void {
    const state = this.state;
    state.symbol = this.inputs.symbol();
    state.timeframe = this.inputs.timeframe();
    state.barTimeSeconds = this.inputs.barTimeSeconds();
    state.anchorPrice = this.inputs.bid();
    state.askPrice = this.inputs.ask();
    state.quote = this.quote;
    this.primitive.update(state);
  }
}
