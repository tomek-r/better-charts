/**
 * Bridge transfer limits — read from the shared config `config/bridge.json`,
 * which `crates/trading-core/src/protocol/limits.rs` embeds at compile time.
 * One file, both languages: edit the JSON, never a copy. The backend validates
 * the same bounds, so a drifting copy here would accept (or advertise) a value
 * the handshake rejects.
 */
import config from '../../../../../config/bridge.json';

/** Frame bytes: what the settings offer and what the handshake negotiates. */
export const FRAME_BYTES = config.frameBytes;

/** Bars per history request; the backend bounds `bars` by the same value. */
export const HISTORY_BARS = config.historyBars;
