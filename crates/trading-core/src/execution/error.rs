use rust_decimal::Decimal;
use thiserror::Error;

use super::types::ExecutionState;

pub(super) const MAX_COMMAND_ID: usize = 128;
pub(super) const MAX_SYMBOL: usize = 128;
pub(super) const MAX_SERVER: usize = 128;
pub(super) const MAX_DECIMAL: usize = 64;
pub(super) const MAX_BROKER_ID: usize = 128;
pub(super) const MAX_RETCODE_MESSAGE: usize = 256;

/// Journal/recovery schema version of the execution records. Old journals
/// must keep replaying unchanged: journaled field names are never renamed or
/// removed. Adding a new [`super::types::ExecutionOperation`] variant breaks old readers
/// (serde rejects the unknown variant), so such a change requires bumping
/// this constant together with a journal migration.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExecutionError {
    #[error("invalid field: {0}")]
    InvalidField(&'static str),
    #[error("field {0} exceeds {1} bytes")]
    FieldTooLong(&'static str, usize),
    #[error("field {0} must not be empty")]
    EmptyField(&'static str),
    #[error("field {0} is not a valid positive decimal")]
    InvalidDecimal(&'static str),
    #[error("command ID {0:?} is already registered with another payload")]
    CommandIdConflict(String),
    #[error("command ID {0:?} is not registered")]
    NotFound(String),
    #[error("transition from {from:?} to {to:?} is not allowed")]
    InvalidTransition {
        from: ExecutionState,
        to: ExecutionState,
    },
    #[error("event timestamp {next} precedes previous timestamp {previous}")]
    TimestampRegression { previous: u64, next: u64 },
    #[error("resolving Unknown requires broker IDs or a broker retcode")]
    MissingBrokerEvidence,
    #[error("command {0:?} is in Unknown; apply_update never exits Unknown")]
    UnknownRequiresResolution(String),
    #[error("field {0} must not contain surrounding whitespace or control characters")]
    InvalidText(&'static str),
}

pub(super) fn bounded_nonempty(
    name: &'static str,
    value: &str,
    max: usize,
) -> Result<(), ExecutionError> {
    if value.trim().is_empty() {
        return Err(ExecutionError::EmptyField(name));
    }
    if value.len() > max {
        return Err(ExecutionError::FieldTooLong(name, max));
    }
    Ok(())
}

pub(super) fn bounded_identity(
    name: &'static str,
    value: &str,
    max: usize,
) -> Result<(), ExecutionError> {
    bounded_nonempty(name, value, max)?;
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(ExecutionError::InvalidText(name));
    }
    Ok(())
}

pub(super) fn validate_message(message: &str) -> Result<(), ExecutionError> {
    if message.chars().count() > MAX_RETCODE_MESSAGE {
        return Err(ExecutionError::FieldTooLong("message", MAX_RETCODE_MESSAGE));
    }
    if message.chars().any(char::is_control) {
        return Err(ExecutionError::InvalidText("message"));
    }
    Ok(())
}

pub(super) fn positive_decimal(name: &'static str, value: &str) -> Result<Decimal, ExecutionError> {
    bounded_nonempty(name, value, MAX_DECIMAL)?;
    // Same strict grammar as the wire's `order_decimal` (protocol.rs): plain
    // digits only — no exponents, no surrounding whitespace, positive.
    crate::protocol::order_decimal(value, true).map_err(|_| ExecutionError::InvalidDecimal(name))
}

/// SL/TP level on a modify: a positive price OR "0" — the explicit "remove
/// this level" sentinel (MT5 clears a stop at price 0).
pub(super) fn level_decimal(name: &'static str, value: &str) -> Result<Decimal, ExecutionError> {
    bounded_nonempty(name, value, MAX_DECIMAL)?;
    let parsed = crate::protocol::order_decimal(value, false)
        .map_err(|_| ExecutionError::InvalidDecimal(name))?;
    if parsed < Decimal::ZERO {
        return Err(ExecutionError::InvalidDecimal(name));
    }
    Ok(parsed)
}
