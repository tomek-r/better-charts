//! Private desktop configuration. A saved edit takes effect at once, without a restart:
//! the settings in force (the saved values with the `MT5_*` overrides applied, see
//! [`AppSettingsState::runtime_variable`]) are what every reader of a setting asks, the
//! execution permission and the MT5 paths are re-applied by the save, and a changed
//! bridge endpoint makes the bridge server re-bind (see `bridge::endpoint`).
//!
//! Installation paths the user has not set are filled from an MT5 installation
//! detected on this machine (see `detected_paths`). A value the user set, and any
//! field an `MT5_*` override supplies, is never replaced, and the auto-start flag is
//! never touched, so a filled path cannot make the app start MT5 by itself. An
//! installation the user picks in the setup guide replaces the installation paths
//! instead, because that choice is explicit.

mod detected_paths;

use crate::{
    bridge::{
        connection::validate_bind_address,
        endpoint::{BridgeEndpoint, BridgeEndpointControl},
        handshake::configured_transfer_limits,
        state::DEFAULT_ADDR,
    },
    execution_adapter::{ExecutionAdapterState, ExecutionQueueView},
    execution_journal::app_data_dir,
    mt5_backend::{Mt5BackendConfig, Mt5BackendState},
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
        Mutex,
    },
};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

const SETTINGS_FILE: &str = "settings.json";
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
/// Bytes of a generated bridge token; its hex form is twice as long.
const GENERATED_TOKEN_BYTES: usize = 32;
/// Why a save that would restart the bridge listener is refused.
const BRIDGE_CHANGE_REFUSED: &str =
    "An order is queued or in flight. Wait for it to settle before changing the bridge connection.";

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
            address: DEFAULT_ADDR.into(),
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

    fn variable(&self, name: &str) -> Option<String> {
        self.variables()
            .into_iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value)
    }

    /// The MT5 process settings these values describe, read the way the backend reads
    /// its `MT5_*` variables.
    pub(crate) fn backend_config(&self) -> Mt5BackendConfig {
        Mt5BackendConfig::resolve(&|name| self.variable(name))
    }

    fn bridge_endpoint(&self) -> BridgeEndpoint {
        BridgeEndpoint {
            address: self.address.clone(),
            token: self.token.clone(),
            max_frame_bytes: self.max_frame_bytes,
        }
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
    pub platform: &'static str,
    pub overridden_keys: Vec<String>,
    /// Fields this load filled from an MT5 installation detected on this computer.
    pub detected_fields: Vec<&'static str>,
    pub configuration_error: Option<String>,
}

struct StoredSettings {
    view: AppSettingsView,
    /// The settings in force: the saved values with the overrides applied, and with
    /// execution and auto-start forced off while a runtime configuration error exists.
    effective: AppSettings,
}

/// What a save changed in the running application, for the caller to apply while the
/// save still holds the settings lock, so concurrent saves apply in the order they
/// were stored.
pub(crate) struct AppliedSettings {
    pub effective: AppSettings,
    /// The bridge endpoint to serve with from now on; `None` when the save left it as it was.
    pub endpoint_change: Option<BridgeEndpoint>,
}

pub(crate) struct AppSettingsState {
    path: Option<PathBuf>,
    inner: Mutex<StoredSettings>,
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
        settings.trading_enabled &= configured;
        Self {
            path,
            overrides,
            runtime_error,
            inner: Mutex::new(StoredSettings {
                effective: settings.clone(),
                view: AppSettingsView {
                    mt5_bridge_settings: settings,
                    configured,
                    first_launch: !persisted || error.is_some(),
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

    /// Whether the settings in force allow order execution.
    pub(crate) fn trading_enabled(&self) -> bool {
        self.effective().trading_enabled
    }

    fn effective(&self) -> AppSettings {
        self.inner
            .lock()
            .expect("settings mutex poisoned")
            .effective
            .clone()
    }

    /// `stored` as the app runs with it: overrides applied, and execution and auto-start
    /// forced off while a runtime configuration error exists (fail closed).
    fn effective_from(&self, stored: &AppSettings) -> AppSettings {
        let (mut effective, _) = stored.clone().with_overrides(&self.overrides);
        if self.runtime_error.is_some() {
            effective.trading_enabled = false;
            effective.auto_start_mt5 = false;
        }
        effective
    }

    /// The value of the `MT5_*` setting `name` in force right now, or `None` for a name
    /// that is not a setting. Every reader of an MT5 setting asks this instead of the
    /// process environment, which is written once at startup and never again.
    pub(crate) fn runtime_variable(&self, name: &str) -> Option<String> {
        self.effective().variable(name)
    }

    /// [`Self::runtime_variable`] for a setting, the process environment for any other
    /// name (`HOME`, `ProgramFiles`, ...): the lookup discovery needs for both.
    pub(crate) fn variable_or_process_env(&self, name: &str) -> Option<String> {
        self.runtime_variable(name).or_else(|| env::var(name).ok())
    }

    pub(crate) fn backend_config(&self) -> Mt5BackendConfig {
        self.effective().backend_config()
    }

    pub(crate) fn bridge_endpoint(&self) -> BridgeEndpoint {
        self.effective().bridge_endpoint()
    }

    fn view(&self) -> Result<AppSettingsView, String> {
        self.inner
            .lock()
            .map(|inner| inner.view.clone())
            .map_err(|_| "Settings are unavailable".into())
    }

    /// Stores `settings` and makes them the ones in force.
    ///
    /// A save that changes the bridge endpoint ends the MT5 session, so it is refused
    /// before anything is written while `queue` holds an order. `apply` receives the new
    /// effective settings after they are stored and runs under the settings lock; it must
    /// not read settings from this state.
    fn save(
        &self,
        settings: AppSettings,
        queue: &ExecutionQueueView,
        apply: impl FnOnce(AppliedSettings),
    ) -> Result<AppSettingsView, String> {
        let mut inner = self.inner.lock().map_err(|_| "Settings are unavailable")?;
        let path = self
            .path
            .as_ref()
            .ok_or("Settings directory is unavailable")?;
        settings.validate()?;
        let effective = self.effective_from(&settings);
        let endpoint = effective.bridge_endpoint();
        let endpoint_change = (endpoint != inner.effective.bridge_endpoint()).then_some(endpoint);
        if endpoint_change.is_some() && queue.order_pending() {
            return Err(BRIDGE_CHANGE_REFUSED.into());
        }
        persist(path, &settings)?;
        inner.view.mt5_bridge_settings = settings;
        inner.view.configured = true;
        inner.view.first_launch = false;
        // The saved values are the user's own, so no field is a detected one any more.
        inner.view.detected_fields = Vec::new();
        inner.view.configuration_error = self.runtime_error.clone();
        inner.effective = effective.clone();
        apply(AppliedSettings {
            effective,
            endpoint_change,
        });
        Ok(inner.view.clone())
    }

    /// Fills the installation paths the user has not set from the installation an
    /// install just wrote into, and stores them when a valid settings file exists.
    ///
    /// Best effort by design: an install never fails because settings could not be
    /// filled, the user's own values and `auto_start_mt5` stay exactly as they are,
    /// and a field an `MT5_*` override supplies is not touched.
    pub(crate) fn fill_from_installation(&self, installation: &Mt5Installation) {
        self.store_installation_paths(|saved, overridden| {
            fill_detected_paths(saved, installation, overridden)
        });
    }

    /// Stores the installation paths of the installation the user picked in the setup
    /// guide, so the running app and the next launch reach that terminal and nothing has
    /// to be picked again.
    ///
    /// The pick is explicit, so it replaces the saved installation paths instead of
    /// filling the unset ones; a field an `MT5_*` override supplies keeps the override.
    /// Best effort like the fill above, and the auto-start flag stays the user's: the
    /// saved paths never start MT5 by themselves.
    pub(crate) fn store_chosen_installation(&self, installation: &Mt5Installation) {
        self.store_installation_paths(|saved, overridden| {
            chosen_installation_paths(saved, installation, overridden)
        });
    }

    /// Stores the settings `paths` derives from the saved file and mirrors them in the
    /// view and in the settings in force, including the fields the installation
    /// supplied.
    ///
    /// Best effort: a settings directory the app has none of, a missing or unreadable
    /// settings file, no changed field, and a failed write all leave the settings as
    /// they are instead of failing the caller.
    fn store_installation_paths(
        &self,
        paths: impl FnOnce(&AppSettings, &[String]) -> (AppSettings, Vec<&'static str>),
    ) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        let Some(path) = self.path.as_deref() else {
            return;
        };
        let Ok(Some(saved)) = read_file(path) else {
            return;
        };
        let (updated, fields) = paths(&saved, &inner.view.overridden_keys);
        if fields.is_empty() || persist(path, &updated).is_err() {
            return;
        }
        inner.effective = self.effective_from(&updated);
        let (shown, _) = updated.with_overrides(&self.overrides);
        inner.view.mt5_bridge_settings = shown;
        inner.view.detected_fields = fields;
    }
}

#[tauri::command]
pub(crate) fn get_app_settings(
    state: tauri::State<'_, AppSettingsState>,
) -> Result<AppSettingsView, String> {
    state.view()
}
/// Saves the settings and applies them to the running app: the execution permission
/// (turning it off drops the queued commands), the MT5 paths, and a changed bridge
/// endpoint. Refused before anything is written when the endpoint would change while an
/// order is queued or in flight.
#[tauri::command]
pub(crate) fn save_app_settings(
    settings: AppSettings,
    state: tauri::State<'_, AppSettingsState>,
    adapter: tauri::State<'_, ExecutionAdapterState>,
    backend: tauri::State<'_, Mt5BackendState>,
    endpoint: tauri::State<'_, BridgeEndpointControl>,
) -> Result<AppSettingsView, String> {
    state.save(settings, &adapter.queue_status(), |applied| {
        adapter.set_local_trading_enabled(applied.effective.trading_enabled);
        backend.reconfigure(applied.effective.backend_config());
        if let Some(new_endpoint) = applied.endpoint_change {
            endpoint.replace(new_endpoint);
        }
    })
}

#[cfg(test)]
mod tests;
