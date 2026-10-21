//! Install-to-MT5: find the MT5 installation to target, the MQL5 data folders
//! that belong to it, any copy of the two MQL5 files the app ships, and compile
//! those copies once they are installed.
//!
//! `discover` finds installations on Windows, macOS, and Linux when no `MT5_*`
//! variable is set (the variables stay overrides), `locate` documents the two MT5
//! data-folder layouts and the Wine path mapping, `install` copies the bundled
//! sources into a data folder without disturbing a running order, `compile` runs
//! MetaEditor over the installed copies and reads the log it writes back, and
//! `commands` exposes the two Tauri commands the setup guide calls, which act on the
//! terminal and `MQL5` paths those first two modules report.
//! Starting the terminal stays the backend's job, so nothing here starts MT5.
//!
//! Privacy: below an MT5 folder this module reads directory listings, `origin.txt`
//! (to attribute a standard data folder), the destination copy of the two `.mq5`
//! files the app itself puts there, which the identical-content check needs, and
//! the compile log MetaEditor writes beside one of those two files
//! (`<source stem>.log`), which carries the result of our own compile. Nothing
//! else is opened, because those folders also hold account state, logs, and
//! journal files that are private to the user.

pub(crate) mod commands;
mod compile;
mod discover;
mod install;
mod locate;

#[cfg(test)]
mod tests;
