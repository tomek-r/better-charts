//! Install-to-MT5: find the MT5 installation to target, the MQL5 data folders
//! that belong to it, and any copy of the two MQL5 files the app ships.
//!
//! `discover` finds installations on Windows, macOS, and Linux when no `MT5_*`
//! variable is set (the variables stay overrides), `locate` documents the two MT5
//! data-folder layouts and the Wine path mapping, and `install` copies the bundled
//! sources into a data folder without disturbing a running order. None of them
//! compiles anything or starts anything; the command that acts on these paths
//! arrives in a later task.
//!
//! Privacy: below an MT5 folder this module reads directory listings, `origin.txt`
//! (to attribute a standard data folder), and the destination copy of the two
//! `.mq5` files the app itself puts there, which the identical-content check needs.
//! Nothing else is opened, because those folders also hold account state, logs,
//! and journal files that are private to the user.

mod discover;
mod install;
mod locate;

#[cfg(test)]
mod tests;
