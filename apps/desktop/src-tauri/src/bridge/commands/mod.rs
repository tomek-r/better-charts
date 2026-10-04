//! The frontend command surface of the bridge, grouped by domain:
//! market/control traffic ([`market`]), draft preflight — risk preview and
//! order check ([`draft`]) — and gated order submission ([`execution`]).
//! Every item is re-exported here so the rest of the bridge (and the test
//! suite) keeps referring to them through the module prelude.

pub(crate) mod draft;
pub(crate) mod execution;
pub(crate) mod market;

pub(crate) use self::draft::*;
pub(crate) use self::execution::*;
pub(crate) use self::market::*;
