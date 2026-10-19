//! Domain logic shared by application clients.
//!
//! Includes protocol validation, risk calculations, volume analysis, and the
//! domain foundation for recording execution commands.

pub mod execution;
pub mod margin_projection;
pub mod models;
pub mod partial_close;
pub mod position_sizing;
pub mod protocol;
pub mod symbol_cache;
#[cfg(test)]
mod test_clock;
pub mod volume_profile;
