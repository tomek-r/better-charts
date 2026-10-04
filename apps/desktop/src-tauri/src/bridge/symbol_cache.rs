use super::{
    app_data_dir, BridgeState, BridgeStatus, MarketSnapshot, ReconciliationStatus,
    TickCacheController,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::AtomicU64, Arc, Mutex},
};
use tokio::sync::watch;
use trading_core::{
    protocol::BrokerSymbol,
    symbol_cache::{SymbolCache, SymbolCacheFile},
};

/// Filename of the persistent symbol mirror; the `-v1` suffix tracks the
/// `SymbolCacheFile` version.
pub(crate) const SYMBOL_CACHE_FILE_NAME: &str = "symbol-cache-v1.json";

/// The local symbol mirror plus the file it persists to (`None` disables
/// persistence for this state).
pub(crate) struct SymbolCacheState {
    path: Option<PathBuf>,
    pub(crate) cache: SymbolCache,
}

/// Path of `symbol-cache-v1.json` inside the shared app data directory
/// ([`execution_journal::app_data_dir`]); returns `None` when that directory
/// cannot be resolved.
pub(crate) fn symbol_cache_path() -> Option<PathBuf> {
    Some(app_data_dir()?.join(SYMBOL_CACHE_FILE_NAME))
}

/// Fail-open load: a missing, corrupt, or undecodable file starts an empty
/// cache and never panics.
pub(crate) fn load_symbol_cache(path: Option<&Path>) -> SymbolCache {
    let Some(path) = path else {
        return SymbolCache::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<SymbolCacheFile>(&text).ok())
        .map(SymbolCache::from_file_data)
        .unwrap_or_default()
}

/// Atomic best-effort write: serializes to `<path>.tmp` with `0600`
/// permissions on unix, then renames over the destination.
pub(crate) fn persist_symbol_cache(path: &Path, cache: &SymbolCache) {
    let Ok(payload) = serde_json::to_string_pretty(&cache.to_file()) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let mut tmp_name = path.as_os_str().to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    if write_symbol_cache_file(&tmp_path, payload.as_bytes()).is_err()
        || fs::rename(&tmp_path, path).is_err()
    {
        let _ = fs::remove_file(&tmp_path);
    }
}

pub(crate) fn write_symbol_cache_file(path: &Path, payload: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(payload)?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

impl Default for BridgeState {
    fn default() -> Self {
        Self::with_symbol_cache_path(symbol_cache_path())
    }
}

impl BridgeState {
    /// Builds the state, loading the persistent symbol mirror from
    /// `cache_path`; any load failure fails open to an empty cache.
    pub(crate) fn with_symbol_cache_path(cache_path: Option<PathBuf>) -> Self {
        let cache = load_symbol_cache(cache_path.as_deref());
        let (outbound_signal, _) = watch::channel(0);
        Self {
            status: Arc::new(Mutex::new(BridgeStatus::default())),
            current_session: Arc::new(Mutex::new(None)),
            session_work: Arc::new(Mutex::new(())),
            transfer_limits: Arc::new(Mutex::new(Default::default())),
            tick_price_counts: Arc::new(Mutex::new(false)),
            market: Arc::new(Mutex::new(MarketSnapshot::default())),
            pending_history: Arc::new(Mutex::new(None)),
            expected_history: Arc::new(Mutex::new(None)),
            pending_history_page: Arc::new(Mutex::new(None)),
            expected_history_page: Arc::new(Mutex::new(None)),
            pending_tick_profile: Arc::new(Mutex::new(None)),
            expected_tick_profile: Arc::new(Mutex::new(None)),
            tick_controller: Arc::new(Mutex::new(TickCacheController::default())),
            pending_symbol_search: Arc::new(Mutex::new(None)),
            expected_symbol_search: Arc::new(Mutex::new(None)),
            pending_symbol_info: Arc::new(Mutex::new(None)),
            expected_symbol_info: Arc::new(Mutex::new(None)),
            quote: Arc::new(Mutex::new(None)),
            account: Arc::new(Mutex::new(None)),
            portfolio: Arc::new(Mutex::new(None)),
            pending_risk: Arc::new(Mutex::new(None)),
            expected_risk: Arc::new(Mutex::new(None)),
            pending_order_check: Arc::new(Mutex::new(None)),
            expected_order_check: Arc::new(Mutex::new(None)),
            validated_order_check: Arc::new(Mutex::new(None)),
            pending_reconciliation: Arc::new(Mutex::new(None)),
            expected_reconciliation: Arc::new(Mutex::new(None)),
            reconciliation_status: Arc::new(Mutex::new(ReconciliationStatus::unavailable(
                "bridge not connected",
            ))),
            next_request_id: Arc::new(AtomicU64::new(1)),
            outbound_signal,
            symbol_cache: Arc::new(Mutex::new(SymbolCacheState {
                path: cache_path,
                cache,
            })),
        }
    }

    pub(crate) fn wake_outbound(&self) {
        self.outbound_signal
            .send_modify(|generation| *generation = generation.wrapping_add(1));
    }

    /// Mirrors accepted MT5 symbols into the local cache and persists the
    /// file only after at least one entry was accepted.
    pub(crate) fn remember_symbols(&self, symbols: impl IntoIterator<Item = BrokerSymbol>) {
        let mut guard = self
            .symbol_cache
            .lock()
            .expect("symbol cache mutex poisoned");
        let mut accepted = false;
        for symbol in symbols {
            if guard.cache.upsert(symbol).is_ok() {
                accepted = true;
            }
        }
        if !accepted {
            return;
        }
        if let Some(path) = guard.path.clone() {
            persist_symbol_cache(&path, &guard.cache);
        }
    }
}
