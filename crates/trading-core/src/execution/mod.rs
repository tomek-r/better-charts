//! Broker-independent execution command intent and lifecycle registry.
//!
//! This module only validates and records command state. It has no persistence
//! backend and cannot dispatch broker operations.

mod error;
mod recovery;
mod registry;
mod types;

pub use error::{ExecutionError, SCHEMA_VERSION};
pub use recovery::{RecoveryEntry, RecoveryOperation};
pub use registry::{ExecutionRecord, ExecutionRegistry};
pub use types::{
    BrokerEvidence, CancelOrder, CloseOrder, CommandStatus, ExecutionEvent, ExecutionIntent,
    ExecutionOperation, ExecutionState, ExecutionUpdate, ModifyOrder, OrderKind, OrderSide,
    PlaceOrder, TargetKind, UnknownResolution,
};

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
