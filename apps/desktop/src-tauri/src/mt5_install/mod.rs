//! Install-to-MT5: find the MT5 installation to target, the MQL5 data folders
//! that belong to it, and any copy of the two MQL5 files the app ships.
//!
//! `discover` finds installations on Windows, macOS, and Linux when no `MT5_*`
//! variable is set (the variables stay overrides), and `locate` documents the two
//! MT5 data-folder layouts, the Wine path mapping, and the privacy rule (only
//! `origin.txt` and directory listings are read). Nothing here copies, compiles,
//! or starts anything; the command that acts on these paths arrives in a later
//! task.

mod discover;
mod locate;

#[cfg(test)]
mod tests;
