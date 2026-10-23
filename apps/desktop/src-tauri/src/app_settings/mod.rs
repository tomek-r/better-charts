//! Private desktop configuration. Saved edits take effect on the next launch.
//!
//! Installation paths the user has not set are filled from an MT5 installation
//! detected on this machine (see `detected_paths`). A value the user set, and any
//! field an `MT5_*` override supplies, is never replaced, and the auto-start flag is
//! never touched, so a filled path cannot make the app start MT5 by itself. An
//! installation the user picks in the setup guide replaces the installation paths
//! instead, because that choice is explicit.

mod detected_paths;

use crate::{
    bridge::{connection::validate_bind_address, handshake::configured_transfer_limits},
    execution_journal::app_data_dir,
    mt5_install::discover::Mt5Installation,
};
use detected_paths::{chosen_installation_paths, discovered_installation, fill_detected_paths};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

const SETTINGS_FILE: &str = "settings.json";
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
/// Bytes of a generated bridge token; its hex form is twice as long.
const GENERATED_TOKEN_BYTES: usize = 32;

// Deliberately no Debug: this model contains an authentication secret.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppSettings {
    pub token: String,
    pub address: String,
    pub max_frame_bytes: u32,
    pub trading_enabled: bool,
    pub auto_start_mt5: bool,
    pub terminal_path: String,
    pub wine_prefix: String,
    pub wine_binary: String,
    pub config_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            token: String::new(),
            address: "127.0.0.1:8765".into(),
            max_frame_bytes: trading_core::protocol::default_frame_bytes(),
            trading_enabled: false,
            auto_start_mt5: false,
            terminal_path: String::new(),
            wine_prefix: String::new(),
            wine_binary: "wine".into(),
            config_path: String::new(),
        }
    }
}

impl AppSettings {
    fn validate(&self) -> Result<(), String> {
        if self.token.trim().is_empty()
            || self.token.len() > 512
            || self.token.chars().any(char::is_control)
        {
            return Err("Token must contain 1–512 bytes and no control characters".into());
        }
        let address = validate_bind_address(&self.address).map_err(str::to_owned)?;
        if address.port() == 0 {
            return Err("Bridge port must be between 1 and 65535".into());
        }
        configured_transfer_limits(Some(&self.max_frame_bytes.to_string()))
            .map_err(str::to_owned)?;
        for path in [
            &self.terminal_path,
            &self.wine_prefix,
            &self.wine_binary,
            &self.config_path,
        ] {
            if path.len() > 4096 || path.chars().any(char::is_control) {
                return Err("Installation paths must be at most 4096 bytes and contain no control characters".into());
            }
        }
        if self.auto_start_mt5
            && (self.terminal_path.trim().is_empty()
                || (!cfg!(windows)
                    && (self.wine_prefix.trim().is_empty() || self.wine_binary.trim().is_empty())))
        {
            return Err("Auto-start requires an MT5 executable and, on macOS/Linux, a Wine prefix and executable".into());
        }
        Ok(())
    }

    fn variables(&self) -> Vec<(&'static str, String)> {
        vec![
            ("MT5_BRIDGE_TOKEN", self.token.clone()),
            ("MT5_BRIDGE_ADDR", self.address.clone()),
            (
                "MT5_BRIDGE_MAX_FRAME_BYTES",
                self.max_frame_bytes.to_string(),
            ),
            (
                "MT5_BRIDGE_TRADING_ENABLED",
                self.trading_enabled.to_string(),
            ),
            ("MT5_BACKEND_ENABLED", self.auto_start_mt5.to_string()),
            ("MT5_TERMINAL_EXE", self.terminal_path.clone()),
            ("MT5_WINE_PREFIX", self.wine_prefix.clone()),
            ("MT5_WINE_BINARY", self.wine_binary.clone()),
            ("MT5_BACKEND_INI", self.config_path.clone()),
        ]
    }

    fn with_overrides(mut self, overrides: &HashMap<String, String>) -> (Self, Vec<String>) {
        let mut keys = Vec::new();
        for (env_key, field) in [
            ("MT5_BRIDGE_TOKEN", "token"),
            ("MT5_BRIDGE_ADDR", "address"),
            ("MT5_BRIDGE_MAX_FRAME_BYTES", "maxFrameBytes"),
            ("MT5_BRIDGE_TRADING_ENABLED", "tradingEnabled"),
            ("MT5_BACKEND_ENABLED", "autoStartMt5"),
            ("MT5_TERMINAL_EXE", "terminalPath"),
            ("MT5_WINE_PREFIX", "winePrefix"),
            ("MT5_WINE_BINARY", "wineBinary"),
            ("MT5_BACKEND_INI", "configPath"),
        ] {
            if let Some(value) = overrides.get(env_key) {
                keys.push(field.to_owned());
                match env_key {
                    "MT5_BRIDGE_TOKEN" => self.token = value.clone(),
                    "MT5_BRIDGE_ADDR" => self.address = value.clone(),
                    "MT5_BRIDGE_MAX_FRAME_BYTES" => {
                        self.max_frame_bytes = value.parse().unwrap_or(0)
                    }
                    "MT5_BRIDGE_TRADING_ENABLED" => self.trading_enabled = enabled(value),
                    "MT5_BACKEND_ENABLED" => self.auto_start_mt5 = enabled(value),
                    "MT5_TERMINAL_EXE" => self.terminal_path = value.clone(),
                    "MT5_WINE_PREFIX" => self.wine_prefix = value.clone(),
                    "MT5_WINE_BINARY" => self.wine_binary = value.clone(),
                    "MT5_BACKEND_INI" => self.config_path = value.clone(),
                    _ => unreachable!(),
                }
            }
        }
        (self, keys)
    }
}

fn enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettingsView {
    pub mt5_bridge_settings: AppSettings,
    pub configured: bool,
    pub first_launch: bool,
    pub restart_required: bool,
    pub platform: &'static str,
    pub overridden_keys: Vec<String>,
    /// Fields this load filled from an MT5 installation detected on this computer.
    pub detected_fields: Vec<&'static str>,
    pub configuration_error: Option<String>,
}

struct StoredSettings {
    view: AppSettingsView,
}
pub(crate) struct AppSettingsState {
    path: Option<PathBuf>,
    inner: Mutex<StoredSettings>,
    startup_trading_enabled: bool,
    startup_settings: AppSettings,
    overrides: HashMap<String, String>,
    runtime_error: Option<String>,
}

fn read_file(path: &Path) -> Result<Option<AppSettings>, String> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read saved settings".into()),
    };
    if file
        .metadata()
        .map_err(|_| "Cannot read saved settings")?
        .len()
        > MAX_SETTINGS_BYTES
    {
        return Err("Saved settings file is too large".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read saved settings")?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("Saved settings file is too large".into());
    }
    let settings: AppSettings =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid saved settings")?;
    settings.validate().map_err(|_| "Invalid saved settings")?;
    Ok(Some(settings))
}

fn persist(path: &Path, settings: &AppSettings) -> Result<(), String> {
    settings.validate()?;
    let parent = path.parent().ok_or("Settings directory is unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create settings directory")?;
    let temporary = parent.join(format!(
        ".settings-{}-{}-{}.tmp",
        std::process::id(),
        FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Cannot save settings")?
            .as_nanos()
    ));
    let mut created = false;
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot create private settings file")?;
        created = true;
        serde_json::to_writer_pretty(&mut file, settings).map_err(|_| "Cannot encode settings")?;
        file.write_all(b"\n").map_err(|_| "Cannot write settings")?;
        file.sync_all().map_err(|_| "Cannot flush settings")?;
        drop(file);
        // Same-directory rename replaces files on Windows and Unix; never delete
        // the previous settings before the replacement has been fully written.
        fs::rename(&temporary, path).map_err(|_| "Cannot replace saved settings")?;
        Ok(())
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(temporary);
    }
    result
}

/// Random bridge token: [`GENERATED_TOKEN_BYTES`] random bytes as lowercase hex, so
/// a first launch has a secret nobody has to invent. `None` when the system offers
/// no randomness, which leaves the token empty exactly as before.
fn generated_token() -> Option<String> {
    let mut bytes = [0u8; GENERATED_TOKEN_BYTES];
    getrandom::fill(&mut bytes).ok()?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Some(token)
}

/// Gives `stored` a generated token when it holds none and no `MT5_BRIDGE_TOKEN`
/// override supplies one, and writes the settings at once, so the bridge, the
/// environment exported at startup and the EA preset all carry the same token; a
/// restart without one is refused, and the user never has to invent it.
///
/// Best effort: settings that cannot be written leave the token in use for this
/// launch anyway.
fn fill_generated_token(
    path: Option<&Path>,
    stored: &mut AppSettings,
    overrides: &HashMap<String, String>,
) {
    if !stored.token.is_empty() || overrides.contains_key("MT5_BRIDGE_TOKEN") {
        return;
    }
    let Some(token) = generated_token() else {
        return;
    };
    stored.token = token;
    if let Some(path) = path {
        let _ = persist(path, stored);
    }
}

impl AppSettingsState {
    pub(crate) fn load(runtime_error: Option<String>) -> Self {
        let path = app_data_dir().map(|directory| directory.join(SETTINGS_FILE));
        let overrides: HashMap<_, _> = AppSettings::default()
            .variables()
            .into_iter()
            .filter_map(|(key, _)| env::var(key).ok().map(|value| (key.to_owned(), value)))
            .collect();
        let state = Self::resolve_with_installation(
            path,
            overrides,
            runtime_error,
            discovered_installation(),
        );
        let settings = state
            .inner
            .lock()
            .expect("settings mutex poisoned")
            .view
            .mt5_bridge_settings
            .clone();
        // This happens before application threads start; save never mutates env.
        for (key, value) in settings.variables() {
            if env::var_os(key).is_none() {
                env::set_var(key, value);
            }
        }
        // A corrupt persisted configuration must never enable execution or spawn.
        if state
            .inner
            .lock()
            .expect("settings mutex poisoned")
            .view
            .configuration_error
            .is_some()
        {
            env::set_var("MT5_BACKEND_ENABLED", "false");
        }
        state
    }

    /// Test entry point: resolution without an installation to fill paths from.
    #[cfg(test)]
    fn resolve(
        path: Option<PathBuf>,
        overrides: HashMap<String, String>,
        dotenv_error: Option<String>,
    ) -> Self {
        Self::resolve_with_installation(path, overrides, dotenv_error, None)
    }

    /// Resolution core: reads the settings file, applies the `MT5_*` overrides, fills
    /// the installation paths the user left unset from `installation`, and stores
    /// those fills once a settings file that is already there holds valid values.
    fn resolve_with_installation(
        path: Option<PathBuf>,
        overrides: HashMap<String, String>,
        dotenv_error: Option<String>,
        installation: Option<Mt5Installation>,
    ) -> Self {
        let saved = path.as_ref().map_or(Ok(None), |path| read_file(path));
        let (mut base, persisted, mut error) = match saved {
            Ok(Some(settings)) => (settings, true, None),
            Ok(None) => (AppSettings::default(), false, None),
            Err(error) => (AppSettings::default(), false, Some(error)),
        };
        // Only an absent settings file needs a token invented for it: a stored one
        // already carries the user's, and an override is never replaced. The token is
        // stored before the detected paths fill in, so they stay in the form until the
        // user saves them.
        if !persisted && error.is_none() {
            fill_generated_token(path.as_deref(), &mut base, &overrides);
        }
        // Detection fills the file's values before the overrides apply, so an override
        // value is never written into the file and never replaced by a detected one.
        let (_, overridden_keys) = base.clone().with_overrides(&overrides);
        let (stored, detected_fields) = match installation {
            Some(installation) => fill_detected_paths(&base, &installation, &overridden_keys),
            None => (base, Vec::new()),
        };
        let (mut settings, _) = stored.clone().with_overrides(&overrides);
        let mut validation_settings = settings.clone();
        if validation_settings.token.is_empty() {
            validation_settings.token = "unset-token".into();
        }
        let invalid_bool = ["MT5_BRIDGE_TRADING_ENABLED", "MT5_BACKEND_ENABLED"]
            .iter()
            .any(|key| {
                overrides.get(*key).is_some_and(|value| {
                    !matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on" | "0" | "false" | "no" | "off"
                    )
                })
            });
        let runtime_error = dotenv_error.or_else(|| {
            (invalid_bool || validation_settings.validate().is_err())
                .then(|| "Runtime settings are invalid; check environment overrides".into())
        });
        if runtime_error.is_some() {
            error = runtime_error.clone();
        }
        if error.is_some() {
            settings.trading_enabled = false;
            settings.auto_start_mt5 = false;
        }
        // A settings file the user already has takes the detected paths now; on a first
        // launch the form carries them until the user saves, so the file the generated
        // token just created gains no path before that save.
        let store_detected = persisted && error.is_none() && !detected_fields.is_empty();
        if let Some(path) = path.as_ref().filter(|_| store_detected) {
            let _ = persist(path, &stored);
        }
        let configured = error.is_none() && settings.validate().is_ok();
        let startup_trading_enabled = configured && settings.trading_enabled;
        settings.trading_enabled = startup_trading_enabled;
        Self {
            path,
            startup_trading_enabled,
            startup_settings: settings.clone(),
            overrides,
            runtime_error,
            inner: Mutex::new(StoredSettings {
                view: AppSettingsView {
                    mt5_bridge_settings: settings,
                    configured,
                    first_launch: !persisted || error.is_some(),
                    restart_required: false,
                    platform: if cfg!(windows) {
                        "windows"
                    } else if cfg!(target_os = "macos") {
                        "macos"
                    } else {
                        "linux"
                    },
                    overridden_keys,
                    detected_fields,
                    configuration_error: error,
                },
            }),
        }
    }

    pub(crate) fn startup_trading_enabled(&self) -> bool {
        self.startup_trading_enabled
    }
    fn view(&self) -> Result<AppSettingsView, String> {
        self.inner
            .lock()
            .map(|inner| inner.view.clone())
            .map_err(|_| "Settings are unavailable".into())
    }
    fn save(&self, settings: AppSettings) -> Result<AppSettingsView, String> {
        let mut inner = self.inner.lock().map_err(|_| "Settings are unavailable")?;
        let path = self
            .path
            .as_ref()
            .ok_or("Settings directory is unavailable")?;
        persist(path, &settings)?;
        inner.view.mt5_bridge_settings = settings;
        inner.view.configured = true;
        inner.view.first_launch = false;
        // The saved values are the user's own, so no field is a detected one any more.
        inner.view.detected_fields = Vec::new();
        let (effective, _) = inner
            .view
            .mt5_bridge_settings
            .clone()
            .with_overrides(&self.overrides);
        inner.view.restart_required = effective != self.startup_settings;
        inner.view.configuration_error = self.runtime_error.clone();
        Ok(inner.view.clone())
    }

    /// Fills the installation paths the user has not set from the installation an
    /// install just wrote into, and stores them when a valid settings file exists.
    ///
    /// Best effort by design: an install never fails because settings could not be
    /// filled, the user's own values and `auto_start_mt5` stay exactly as they are,
    /// and a field an `MT5_*` override supplies is not touched.
    pub(crate) fn fill_from_installation(&self, installation: &Mt5Installation) {
        // The guard ends the lock section here: a fill leaves the restart hint alone.
        self.store_installation_paths(|saved, overridden| {
            fill_detected_paths(saved, installation, overridden)
        });
    }

    /// Stores the installation paths of the installation the user picked in the setup
    /// guide, so the next launch reaches that terminal and nothing has to be picked
    /// again.
    ///
    /// The pick is explicit, so it replaces the saved installation paths instead of
    /// filling the unset ones; a field an `MT5_*` override supplies keeps the override.
    /// Best effort like the fill above, and the auto-start flag stays the user's: the
    /// saved paths never start MT5 by themselves. The view then reports a restart when
    /// the paths differ from the ones this launch runs with, the same rule `save`
    /// applies, because the bridge and the environment keep the startup values.
    pub(crate) fn store_chosen_installation(&self, installation: &Mt5Installation) {
        let Some(mut inner) = self.store_installation_paths(|saved, overridden| {
            chosen_installation_paths(saved, installation, overridden)
        }) else {
            return;
        };
        inner.view.restart_required = inner.view.mt5_bridge_settings != self.startup_settings;
    }

    /// Stores the settings `paths` derives from the saved file and mirrors them in the
    /// view, including the fields the installation supplied. Returns the guard of the
    /// view when the file now holds them, so the caller can adjust the view inside the
    /// same lock section.
    ///
    /// Best effort: a settings directory the app has none of, a missing or unreadable
    /// settings file, no changed field, and a failed write all leave the view as it is
    /// instead of failing the caller.
    fn store_installation_paths(
        &self,
        paths: impl FnOnce(&AppSettings, &[String]) -> (AppSettings, Vec<&'static str>),
    ) -> Option<MutexGuard<'_, StoredSettings>> {
        let mut inner = self.inner.lock().ok()?;
        let path = self.path.as_deref()?;
        let Ok(Some(saved)) = read_file(path) else {
            return None;
        };
        let (updated, fields) = paths(&saved, &inner.view.overridden_keys);
        if fields.is_empty() || persist(path, &updated).is_err() {
            return None;
        }
        let (effective, _) = updated.with_overrides(&self.overrides);
        inner.view.mt5_bridge_settings = effective;
        inner.view.detected_fields = fields;
        Some(inner)
    }
}

#[tauri::command]
pub(crate) fn get_app_settings(
    state: tauri::State<'_, AppSettingsState>,
) -> Result<AppSettingsView, String> {
    state.view()
}
#[tauri::command]
pub(crate) fn save_app_settings(
    settings: AppSettings,
    state: tauri::State<'_, AppSettingsState>,
) -> Result<AppSettingsView, String> {
    state.save(settings)
}

#[cfg(test)]
mod tests;
