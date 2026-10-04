//! Local MT5 bridge: TCP transport, protocol handling, bridge state,
//! reconciliation and the frontend command surface.
//!
//! The whole module is `pub(crate)`; the only public crate API is `run()`.

pub(crate) mod accept;
pub(crate) mod commands;
pub(crate) mod connection;
pub(crate) mod handshake;
pub(crate) mod inbound_control;
pub(crate) mod inbound_execution;
pub(crate) mod inbound_market;
pub(crate) mod state;
pub(crate) mod symbol_cache;
pub(crate) mod tick_profile;
pub(crate) mod transport;
pub(crate) mod views;

#[cfg(test)]
mod tests;

use accept::*;
use commands::*;
// Only the test suite references it through `use super::*`.
#[cfg(test)]
use connection::validate_bind_address;
use connection::{Inbound, InboundOutcome};
use handshake::*;
use inbound_control::*;
use inbound_execution::*;
use inbound_market::*;
use state::*;
use symbol_cache::*;
use tick_profile::*;
use transport::*;
use views::*;

#[cfg(test)]
use crate::execution_adapter::dispatch_gate;
use crate::execution_adapter::{ExecutionAdapterState, ExecutionQueueView, PendingCommand};
use crate::execution_journal::{app_data_dir, ExecutionSafetyState, ExecutionSafetyStatus};
use crate::mt5_backend::{Mt5BackendState, Mt5BackendStatus};
use tauri::State;
use trading_core::position_sizing::calculate_risk_sizing;
use trading_core::protocol::{
    AccountSnapshot, BarUpdate, HistoryRequest, MarketCandle, MessageType, OrderCancelRequest,
    OrderCheckError, OrderCheckRequest, OrderCheckResult, OrderCloseRequest, OrderKind,
    OrderModifyRequest, OrderSide, OrderSubmitRequest, QuoteUpdate, RiskQuoteRequest,
    SymbolInfoRequest, SymbolInfoResult, SymbolSearchRequest, SymbolSearchResult,
    TickHistoryRequest, TickHistorySnapshot, TimeInForce,
};

// The test modules share their fixture imports through `use super::*`; keep
// that test prelude out of the production module namespace.
#[cfg(test)]
use crate::execution_adapter::ExecutionAdapterError;
#[cfg(test)]
use std::{
    net::SocketAddr,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
#[cfg(test)]
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream},
};
#[cfg(test)]
use trading_core::protocol::{
    encode_json, BrokerSymbol, Envelope, ErrorCode, ErrorPayload, HelloAckPayload, ReconcileError,
    ReconcileRequest, ReconcileSnapshot, PROTOCOL_VERSION,
};
