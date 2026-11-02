import type { BridgeState, MarketSessionStatus } from '../../../../shared/bridge/types';

/** Whether the market of the symbol on screen is open, as far as the bridge can tell. */
export type MarketStatus = 'open' | 'closed' | 'unknown';

/** What the decision reads: the transport state, the EA's latest report and the symbol on screen. */
interface MarketStatusInput {
  bridgeState: BridgeState;
  /** The EA's report for its own active symbol; absent until a heartbeat carries one. */
  session: MarketSessionStatus | undefined;
  /** The symbol the chart shows, absent until it has one; only a report naming it describes it. */
  shownSymbol: string | undefined;
}

interface MarketStatusLabelInput {
  status: MarketStatus;
  bridgeState: BridgeState;
}

/** A connected bridge that has not reported the shown symbol yet. */
export const NO_MARKET_SESSION_LABEL = 'Market status unknown';

const SESSION_LABELS: Record<'open' | 'closed', string> = {
  open: 'Market open',
  closed: 'Market closed',
};

const UNKNOWN_LABELS: Record<BridgeState, string> = {
  connected: NO_MARKET_SESSION_LABEL,
  disconnected: 'Market status unknown: MT5 disconnected',
  connecting: 'Market status unknown: MT5 connecting',
  protocol_error: 'Market status unknown: MT5 connection error',
};

/**
 * The market status of the symbol on screen. The EA reports the session of its own active
 * symbol, so a report left over from the symbol the user just switched away from says nothing
 * about this one.
 */
export function marketStatusOf({ bridgeState, session, shownSymbol }: MarketStatusInput): MarketStatus {
  if (bridgeState !== 'connected' || !session || session.symbol !== shownSymbol) {
    return 'unknown';
  }
  return session.isOpen ? 'open' : 'closed';
}

/** The dot's tooltip and screen-reader label: open, closed, or why the status is unknown. */
export function marketStatusLabel({ status, bridgeState }: MarketStatusLabelInput): string {
  if (status !== 'unknown') {
    return SESSION_LABELS[status];
  }
  return UNKNOWN_LABELS[bridgeState];
}
