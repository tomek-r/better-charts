//! Domain logic shared by application clients.
//!
//! Includes protocol validation, risk calculations, volume analysis, and the
//! domain foundation for recording execution commands.

pub mod execution;
pub mod models;
pub mod position_sizing;
pub mod protocol;
pub mod symbol_cache;
pub mod volume_profile;
