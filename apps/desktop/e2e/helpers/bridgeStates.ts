import type { BridgeStatus } from '../../src/shared/bridge/types';

/** A bridge that has not connected yet and holds no candles, so a blurred screen stands in for the chart. */
export const WAITING_FOR_BRIDGE = {
  get_bridge_status: { state: 'connecting' },
  get_market_snapshot: { complete: false, candles: [] },
};

/** A bridge still waiting for its first EA; the stub's default candles still let the workspace draw its chart. */
export const CONNECTING_BRIDGE = { get_bridge_status: { state: 'connecting' } };

/** The status the stub pushes once the bridge answers, worded like the real one. */
export const CONNECTED_STATUS: BridgeStatus = {
  state: 'connected',
  supportedTimeframes: ['M1'],
  message: 'Bridge connected.',
};

/** The refusal the bridge reports when the EA holds a token this app does not know. */
export const TOKEN_MISMATCH_STATUS: BridgeStatus = {
  state: 'protocol_error',
  message: 'authentication failed',
  tokenMismatch: true,
};
