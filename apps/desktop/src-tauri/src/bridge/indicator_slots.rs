//! Bounded latest-per-key request slots shared by the desktop's read-only
//! indicator routes ([`super::indicator_series`], [`super::indicator_ticks`]):
//! one entry per caller key, ordered oldest first, and a newer request for a key
//! replaces the older one together with the response it still awaited.
//!
//! Each route keeps its slots apart from the chart's own slots and from the tick
//! profile's request, so a read can neither displace those requests nor be
//! consumed as one.

use std::sync::atomic::{AtomicU64, Ordering};

/// A request a read-only indicator route routes back by its caller key: the
/// answer arrives under an id family of the route, and the route keeps only a
/// bounded number of keys at once.
pub(crate) trait KeyedRoute: Clone {
    /// Keys this route keeps at once, queued or awaited; a request for a new key
    /// beyond the bound drops the oldest one.
    const MAX_KEYS: usize;
    /// Request-id family of the route. The EA echoes it on the answer and on a
    /// correlated error, which is how a frame finds the key it answers.
    const ID_PREFIX: &'static str;
    /// The caller's routing key, echoed back unchanged on the answer.
    fn key(&self) -> &str;
}

/// One queued request with the id it was written under, once sent.
#[derive(Debug)]
struct Slot<Request> {
    request: Request,
    /// The id the request was written with; `None` while it waits for the wire.
    request_id: Option<String>,
}

/// A queued request claimed for the wire.
#[derive(Debug)]
pub(crate) struct OutboundSlot<Request> {
    pub(crate) request_id: String,
    pub(crate) request: Request,
}

/// Queued and awaited requests of one route, one entry per caller key and
/// ordered oldest first, so a request beyond the route's bound drops the oldest
/// key.
#[derive(Debug)]
pub(crate) struct LatestPerKeySlots<Request> {
    entries: Vec<Slot<Request>>,
}

impl<Request> Default for LatestPerKeySlots<Request> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

impl<Request: KeyedRoute> LatestPerKeySlots<Request> {
    /// Queues `request`, replacing every trace of its key and, beyond the
    /// route's bound, the oldest key.
    pub(crate) fn queue(&mut self, request: Request) {
        self.entries
            .retain(|entry| entry.request.key() != request.key());
        if self.entries.len() >= Request::MAX_KEYS {
            self.entries.remove(0);
        }
        self.entries.push(Slot {
            request,
            request_id: None,
        });
    }

    /// Assigns an id to every queued request and returns them for the wire. The
    /// id is recorded before the write on purpose: a request queued for the same
    /// key meanwhile supersedes it, and its response then finds no id to answer.
    pub(crate) fn claim_waiting(
        &mut self,
        next_request_id: &AtomicU64,
    ) -> Vec<OutboundSlot<Request>> {
        self.entries
            .iter_mut()
            .filter(|entry| entry.request_id.is_none())
            .map(|entry| {
                let request_id = format!(
                    "{}{}",
                    Request::ID_PREFIX,
                    next_request_id.fetch_add(1, Ordering::Relaxed)
                );
                entry.request_id = Some(request_id.clone());
                OutboundSlot {
                    request_id,
                    request: entry.request.clone(),
                }
            })
            .collect()
    }

    /// Removes and returns the request awaited under `request_id`; `None` for an
    /// id this route no longer waits for, which the caller ignores.
    pub(crate) fn take_awaited(&mut self, request_id: &str) -> Option<Request> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.request_id.as_deref() == Some(request_id))?;
        Some(self.entries.remove(index).request)
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
    }
}
