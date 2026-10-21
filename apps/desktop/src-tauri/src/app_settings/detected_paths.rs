//! Fill installation paths that MT5 detection finds on this machine into the
//! settings fields the user has left unset.
//!
//! Detection only ever adds values the user did not choose: an empty terminal path,
//! an empty Wine prefix, and the shared default Wine binary. A path an `MT5_*`
//! variable supplies and any other non-empty value stays exactly as it is, and
//! `auto_start_mt5` is never touched, so detected paths can never make the app start
//! MT5 by itself. Nothing else in the settings changes.

use std::path::Path;

use super::AppSettings;
use crate::mt5_backend::DEFAULT_WINE_BINARY;
use crate::mt5_install::discover::{discover_this_machine, InstallationSource, Mt5Installation};

/// Field names the settings view and its form use, reported back as filled.
const TERMINAL_PATH_FIELD: &str = "terminalPath";
const WINE_PREFIX_FIELD: &str = "winePrefix";
const WINE_BINARY_FIELD: &str = "wineBinary";

/// The first installation this machine reports by discovery alone.
///
/// A configured `MT5_TERMINAL_EXE` yields [`InstallationSource::Configured`], which
/// is the user's own choice and therefore never filled in.
pub(super) fn discovered_installation() -> Option<Mt5Installation> {
    discover_this_machine()
        .into_iter()
        .find(|installation| installation.source == InstallationSource::Discovered)
}

/// An empty path reads as unset, the same rule the backend applies to a blank
/// `MT5_*` variable.
fn is_blank(value: &str) -> bool {
    value.trim().is_empty()
}

/// The Wine binary counts as unset while it is empty or still the shared default
/// every installation starts with.
fn wine_binary_is_unset(value: &str) -> bool {
    is_blank(value) || value.trim() == DEFAULT_WINE_BINARY
}

/// Whether `field` may take `detected`: the field is unset, detection found a value,
/// and no `MT5_*` override supplies the field.
fn is_fillable(unset: bool, detected: &str, field: &str, overridden: &[String]) -> bool {
    unset && !is_blank(detected) && !overridden.iter().any(|key| key == field)
}

/// Host path of a Wine setting an installation reports; empty when the installation
/// has none, which is every installation on a Windows host.
fn wine_path_text(path: Option<&Path>) -> String {
    path.map_or_else(String::new, |path| path.to_string_lossy().into_owned())
}

/// `settings` with every unset, non-overridden installation path filled from
/// `installation`, and the names of the fields that changed.
///
/// `overridden` holds the field names the settings view reports as supplied by the
/// environment, so an override always wins over a detected value. Every other field
/// — the token, the auto-start flag, the startup configuration — is copied through
/// untouched.
pub(crate) fn fill_detected_paths(
    settings: &AppSettings,
    installation: &Mt5Installation,
    overridden: &[String],
) -> (AppSettings, Vec<&'static str>) {
    let mut filled = settings.clone();
    let mut fields = Vec::new();
    let terminal_unset = is_blank(&settings.terminal_path);
    let prefix_unset = is_blank(&settings.wine_prefix);
    let binary_unset = wine_binary_is_unset(&settings.wine_binary);
    let terminal_path = installation.terminal_exe_windows.trim().to_string();
    if is_fillable(
        terminal_unset,
        &terminal_path,
        TERMINAL_PATH_FIELD,
        overridden,
    ) {
        filled.terminal_path = terminal_path;
        fields.push(TERMINAL_PATH_FIELD);
    }
    let wine_prefix = wine_path_text(installation.wine_prefix.as_deref());
    if is_fillable(prefix_unset, &wine_prefix, WINE_PREFIX_FIELD, overridden) {
        filled.wine_prefix = wine_prefix;
        fields.push(WINE_PREFIX_FIELD);
    }
    let wine_binary = wine_path_text(installation.wine_binary.as_deref());
    if is_fillable(binary_unset, &wine_binary, WINE_BINARY_FIELD, overridden) {
        filled.wine_binary = wine_binary;
        fields.push(WINE_BINARY_FIELD);
    }
    (filled, fields)
}
