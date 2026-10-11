//! Safety gate for partial closes. An EA that does not understand
//! `order_close_request.volume` would ignore it and close the WHOLE position,
//! so the volume is only forwarded to an EA that negotiated `partial_close`
//! and only after it passes the symbol's volume rules.

use super::super::BridgeState;

const UNSUPPORTED_BY_EA: &str = "partial close is not supported by the connected EA; update the EA";
const LIMITS_UNAVAILABLE: &str = "position volume limits are unavailable";

/// Lock order: callers hold `session_work`; this takes status then portfolio,
/// one at a time.
pub(crate) fn require_partial_close_allowed(
    bridge: &BridgeState,
    position_id: &str,
    volume: &str,
) -> Result<(), String> {
    if !negotiated_partial_close(bridge)? {
        return Err(UNSUPPORTED_BY_EA.into());
    }
    let limits = bridge
        .portfolio
        .lock()
        .map_err(|_| "portfolio snapshot unavailable".to_string())?
        .as_ref()
        .and_then(|portfolio| portfolio.partial_close_limits(position_id))
        .ok_or_else(|| LIMITS_UNAVAILABLE.to_string())?;
    limits
        .validate_text(volume)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn negotiated_partial_close(bridge: &BridgeState) -> Result<bool, String> {
    bridge
        .status
        .lock()
        .map(|status| status.partial_close)
        .map_err(|_| "bridge status unavailable".to_string())
}
