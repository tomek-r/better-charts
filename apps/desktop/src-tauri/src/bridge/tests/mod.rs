//! Unit tests for the bridge module, split by production-code area.
//!
//! Every submodule pulls the bridge re-exports through `use super::*`
//! (this file re-imports them privately) and shared fixtures through
//! `use super::common::*`.

mod common;
mod connection;
mod dispatch;
mod frontend_views;
mod market_data;
mod order_check;
mod reconciliation;
mod risk_sizing;
mod symbol_cache;
pub(super) mod tick_cache;
mod tick_profile;

use super::*;
