//! The address, token and frame limit the bridge listener serves with.
//!
//! The listener follows this endpoint while the app runs: a settings save that
//! changes it is published through [`BridgeEndpointControl`], and the server task
//! re-binds and ends the current session (see `connection::serve_endpoints`).

use tokio::sync::watch;

/// Deliberately no `Debug`: the token is an authentication secret.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct BridgeEndpoint {
    pub address: String,
    pub token: String,
    pub max_frame_bytes: u32,
}

/// The publisher side of the endpoint the bridge server follows; managed by Tauri.
pub(crate) struct BridgeEndpointControl {
    endpoints: watch::Sender<BridgeEndpoint>,
}

impl BridgeEndpointControl {
    pub(crate) fn new(endpoint: BridgeEndpoint) -> Self {
        let (endpoints, _) = watch::channel(endpoint);
        Self { endpoints }
    }

    /// A receiver that starts at the current endpoint, so it reports only later changes.
    pub(crate) fn subscribe(&self) -> watch::Receiver<BridgeEndpoint> {
        self.endpoints.subscribe()
    }

    /// Makes `endpoint` the one the server serves with, whether or not a receiver exists yet.
    pub(crate) fn replace(&self, endpoint: BridgeEndpoint) {
        self.endpoints.send_replace(endpoint);
    }
}
