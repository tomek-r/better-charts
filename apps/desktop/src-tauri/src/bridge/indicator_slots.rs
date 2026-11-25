//! Bounded latest-per-key request slots shared by the desktop's read-only
//! indicator routes ([`super::indicator_series`], [`super::indicator_ticks`]):
//! one entry per caller key, ordered oldest first, and a newer request for a key
//! replaces the older one together with the response it still awaited.
//!
//! A route whose requests the EA serves one at a time claims one entry and asks
//! for the next only once that one was answered or failed
//! ([`LatestPerKeySlots::claim_next`]); the series route, which the EA serves
//! several pages of at once, claims every waiting entry ([`LatestPerKeySlots::claim_waiting`]).
//!
//! Each route keeps its slots apart from the chart's own slots and from the tick
//! profile's request, so a read can neither displace those requests nor be
//! consumed as one.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

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
    /// When the request was claimed for the wire, for the routes that keep one
    /// request in flight and fail it once it waited too long. `None` while it
    /// waits, and for a route the EA serves several requests of at once.
    claimed_at: Option<Instant>,
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
    /// route's bound, the oldest key. Replacing the awaited request frees the
    /// route's wire slot, because that answer can no longer be asked for.
    pub(crate) fn queue(&mut self, request: Request) {
        self.entries
            .retain(|entry| entry.request.key() != request.key());
        if self.entries.len() >= Request::MAX_KEYS {
            self.entries.remove(0);
        }
        self.entries.push(Slot {
            request,
            request_id: None,
            claimed_at: None,
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

    /// Claims the oldest waiting request for the wire and stamps the claim with
    /// `now`, or answers `None` while one of the route's requests still awaits
    /// its answer: a route the EA serves one request at a time asks for nothing
    /// more until that answer arrives, or the awaited request fails.
    pub(crate) fn claim_next(
        &mut self,
        next_request_id: &AtomicU64,
        now: Instant,
    ) -> Option<OutboundSlot<Request>> {
        if self.is_awaited() {
            return None;
        }
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.request_id.is_none())?;
        let request_id = format!(
            "{}{}",
            Request::ID_PREFIX,
            next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        entry.request_id = Some(request_id.clone());
        entry.claimed_at = Some(now);
        Some(OutboundSlot {
            request_id,
            request: entry.request.clone(),
        })
    }

    /// Whether one of the route's requests is written and still awaits its
    /// answer.
    pub(crate) fn is_awaited(&self) -> bool {
        self.entries.iter().any(|entry| entry.request_id.is_some())
    }

    /// Removes and returns the awaited request once it has waited `timeout` or
    /// longer: its answer can no longer come, and the route's wire slot must be
    /// freed for the requests queued behind it.
    pub(crate) fn take_expired(
        &mut self,
        now: Instant,
        timeout: Duration,
    ) -> Option<OutboundSlot<Request>> {
        let index = self.entries.iter().position(|entry| {
            entry
                .claimed_at
                .is_some_and(|claimed_at| now.saturating_duration_since(claimed_at) >= timeout)
        })?;
        let slot = self.entries.remove(index);
        Some(OutboundSlot {
            request_id: slot.request_id?,
            request: slot.request,
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    const TIMEOUT: Duration = Duration::from_secs(150);

    /// A route that only names its keys: enough to tell queued entries apart.
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct NamedRequest {
        key: &'static str,
    }

    impl KeyedRoute for NamedRequest {
        const MAX_KEYS: usize = 4;
        const ID_PREFIX: &'static str = "rust-test-";

        fn key(&self) -> &str {
            self.key
        }
    }

    fn request(key: &'static str) -> NamedRequest {
        NamedRequest { key }
    }

    fn slots_with(keys: &[&'static str]) -> LatestPerKeySlots<NamedRequest> {
        let mut slots = LatestPerKeySlots::default();
        for key in keys {
            slots.queue(request(key));
        }
        slots
    }

    #[test]
    fn the_single_flight_claim_takes_the_oldest_entry_and_then_waits_for_it() {
        let next_request_id = AtomicU64::new(1);
        let now = Instant::now();
        let mut slots = slots_with(&["oldest", "newer"]);

        let first = slots
            .claim_next(&next_request_id, now)
            .expect("the oldest request goes out");
        assert_eq!(first.request.key, "oldest");
        assert!(first.request_id.starts_with("rust-test-"));
        assert!(slots.is_awaited());

        assert!(
            slots.claim_next(&next_request_id, now).is_none(),
            "nothing more goes out while the first awaits its answer"
        );

        let answered = slots.take_awaited(&first.request_id).expect("awaited");
        assert_eq!(answered.key, "oldest");
        let second = slots
            .claim_next(&next_request_id, now)
            .expect("the next request follows the answer");
        assert_eq!(second.request.key, "newer");
        assert_ne!(first.request_id, second.request_id);
    }

    #[test]
    fn replacing_the_awaited_key_frees_the_slot_for_the_request_it_queued() {
        let next_request_id = AtomicU64::new(1);
        let now = Instant::now();
        let mut slots = slots_with(&["chart-footprint"]);

        let replaced = slots
            .claim_next(&next_request_id, now)
            .expect("the window read goes out");
        slots.queue(request("chart-footprint"));

        assert!(
            slots.take_awaited(&replaced.request_id).is_none(),
            "the replaced request is no longer awaited"
        );
        let current = slots
            .claim_next(&next_request_id, now)
            .expect("the replacement finds the slot free");
        assert_eq!(current.request.key, "chart-footprint");
        assert_ne!(current.request_id, replaced.request_id);
        assert!(
            slots.claim_next(&next_request_id, now).is_none(),
            "the replacement is the one awaited now"
        );
    }

    #[test]
    fn a_request_awaited_past_the_timeout_expires_and_not_before() {
        let next_request_id = AtomicU64::new(1);
        let claimed_at = Instant::now();
        let mut slots = slots_with(&["chart-footprint"]);
        let awaited = slots
            .claim_next(&next_request_id, claimed_at)
            .expect("claimed for the wire");

        assert!(
            slots
                .take_expired(claimed_at + TIMEOUT - Duration::from_secs(1), TIMEOUT)
                .is_none(),
            "a request inside the timeout keeps its slot"
        );
        assert!(slots.is_awaited());

        let expired = slots
            .take_expired(claimed_at + TIMEOUT, TIMEOUT)
            .expect("a request past the timeout expires");
        assert_eq!(expired.request_id, awaited.request_id);
        assert_eq!(expired.request.key, "chart-footprint");
        assert!(
            !slots.is_awaited(),
            "the expired request frees the slot it held"
        );
    }
}
