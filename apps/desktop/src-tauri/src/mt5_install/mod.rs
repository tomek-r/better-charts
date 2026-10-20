//! Install-to-MT5, task 1: find the MQL5 data folders of the configured
//! installation and any copy of the two MQL5 files the app ships.
//!
//! `locate` documents the two MT5 data-folder layouts, the Wine path mapping,
//! and the privacy rule (only `origin.txt` and directory listings are read).
//! Nothing here copies, compiles, or starts anything; the command that acts on
//! these paths arrives in a later task.

mod locate;

#[cfg(test)]
mod tests;
