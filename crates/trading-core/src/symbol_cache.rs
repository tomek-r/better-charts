//! Local, bounded mirror of broker symbols already seen from MT5.
//!
//! The cache is a pure domain structure: it never performs file IO. The
//! desktop shell owns persistence through the versioned [`SymbolCacheFile`]
//! wrapper, and deserialization never bypasses `BrokerSymbol` validation.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::protocol::BrokerSymbol;

/// Maximum number of mirrored symbols; the cache evicts when full.
const MAX_ENTRIES: usize = 512;

/// Version tag stored in the persisted wrapper.
pub const SYMBOL_CACHE_FILE_VERSION: u32 = 1;

/// Versioned, serde-compatible shape of the persisted symbol cache.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolCacheFile {
    pub version: u32,
    pub symbols: Vec<BrokerSymbol>,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    symbol: BrokerSymbol,
    touched: u64,
}

/// Symbols keyed by their case-sensitive name, ordered by a monotonically
/// increasing touch counter so a full cache evicts the least-recently-touched
/// entry. Only `upsert` refreshes recency; `search` and other reads do not
/// touch the clock.
#[derive(Debug, Clone, Default)]
pub struct SymbolCache {
    entries: HashMap<String, CacheEntry>,
    clock: u64,
}

impl SymbolCache {
    /// Validates and mirrors one symbol. An existing entry with the same name
    /// (case-sensitive) is replaced; otherwise the symbol is inserted, evicting
    /// the least-recently-touched entry when the cache is full.
    pub fn upsert(&mut self, symbol: BrokerSymbol) -> Result<(), &'static str> {
        symbol.validate()?;
        let key = symbol.symbol.clone();
        self.clock += 1;
        let touched = self.clock;
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.symbol = symbol;
            entry.touched = touched;
            return Ok(());
        }
        if self.entries.len() >= MAX_ENTRIES {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(name, _)| name.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        self.entries.insert(key, CacheEntry { symbol, touched });
        Ok(())
    }

    /// Exact-name lookup (case-sensitive, matching [`Self::upsert`]'s key).
    pub fn get(&self, symbol: &str) -> Option<&BrokerSymbol> {
        self.entries.get(symbol).map(|entry| &entry.symbol)
    }

    /// Case-insensitive substring search over symbol names and descriptions.
    /// Name matches rank before description-only matches; each group is ordered
    /// by symbol name ascending, deduplicated by name, and capped at `limit`.
    /// A blank query returns no results.
    pub fn search(&self, query: &str, limit: u8) -> Vec<BrokerSymbol> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() || limit == 0 {
            return Vec::new();
        }
        let mut name_matches: Vec<&BrokerSymbol> = Vec::new();
        let mut description_matches: Vec<&BrokerSymbol> = Vec::new();
        for entry in self.entries.values() {
            if entry.symbol.symbol.to_lowercase().contains(&needle) {
                name_matches.push(&entry.symbol);
            } else if entry.symbol.description.to_lowercase().contains(&needle) {
                description_matches.push(&entry.symbol);
            }
        }
        name_matches.sort_by(|left, right| left.symbol.cmp(&right.symbol));
        description_matches.sort_by(|left, right| left.symbol.cmp(&right.symbol));
        let mut seen = HashSet::new();
        name_matches
            .into_iter()
            .chain(description_matches)
            .filter(|symbol| seen.insert(symbol.symbol.to_lowercase()))
            .take(limit as usize)
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Snapshot for persistence, ordered by symbol name for stable files.
    pub fn to_file(&self) -> SymbolCacheFile {
        let mut symbols: Vec<BrokerSymbol> = self
            .entries
            .values()
            .map(|entry| entry.symbol.clone())
            .collect();
        symbols.sort_by(|left, right| left.symbol.cmp(&right.symbol));
        SymbolCacheFile {
            version: SYMBOL_CACHE_FILE_VERSION,
            symbols,
        }
    }

    /// Rebuilds the cache from decoded file data without trusting it: a file
    /// whose version does not match [`SYMBOL_CACHE_FILE_VERSION`] is dropped
    /// entirely, as are entries failing `BrokerSymbol::validate()` and
    /// duplicate names, keeping the first valid entry for each name.
    pub fn from_file_data(data: SymbolCacheFile) -> SymbolCache {
        let mut cache = SymbolCache::default();
        if data.version != SYMBOL_CACHE_FILE_VERSION {
            return cache;
        }
        for symbol in data.symbols {
            if cache.entries.contains_key(&symbol.symbol) {
                continue;
            }
            let _ = cache.upsert(symbol);
        }
        cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn broker_symbol(symbol: &str, description: &str) -> BrokerSymbol {
        BrokerSymbol {
            symbol: symbol.into(),
            description: description.into(),
            digits: 2,
            tick_size: "0.1".into(),
            point_size: "0.1".into(),
            contract_size: "1".into(),
            tick_value_profit: None,
            tick_value_loss: None,
            tick_value_currency: None,
            volume_min: "0.01".into(),
            volume_max: "100".into(),
            volume_step: "0.01".into(),
            trade_mode: 4,
            stops_level: 10,
            freeze_level: 5,
            filling_mode: 3,
            order_mode: 127,
            expiration_mode: 15,
            trade_execution: 2,
        }
    }

    #[test]
    fn upsert_rejects_invalid_replaces_same_name_and_evicts_lru_at_capacity() {
        let mut cache = SymbolCache::default();
        let mut invalid = broker_symbol("BAD", "invalid decimals");
        invalid.tick_size = "not-a-number".into();
        assert!(cache.upsert(invalid).is_err());
        assert!(cache.upsert(broker_symbol("   ", "empty symbol")).is_err());
        assert!(cache.is_empty());

        cache
            .upsert(broker_symbol("EURUSD", "first description"))
            .unwrap();
        assert_eq!(cache.len(), 1);
        cache
            .upsert(broker_symbol("EURUSD", "second description"))
            .unwrap();
        assert_eq!(cache.len(), 1, "same-name upsert replaces in place");
        assert_eq!(
            cache.search("eurusd", 10)[0].description,
            "second description"
        );

        for index in 0..(MAX_ENTRIES - 1) {
            let name = format!("SYM{index:04}");
            cache.upsert(broker_symbol(&name, "filler")).unwrap();
        }
        assert_eq!(cache.len(), MAX_ENTRIES);
        // Touching EURUSD marks it most recent, so the oldest filler goes.
        cache
            .upsert(broker_symbol("EURUSD", "touched description"))
            .unwrap();
        cache.upsert(broker_symbol("NEWW", "newest entry")).unwrap();
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert_eq!(cache.search("eurusd", 10).len(), 1);
        assert_eq!(cache.search("neww", 10).len(), 1);
        assert_eq!(
            cache.search("sym0000", 10).len(),
            0,
            "least-recently-touched entry is evicted"
        );
        assert_eq!(
            cache.search("sym0001", 10).len(),
            1,
            "recently replaced entries survive eviction"
        );
    }

    #[test]
    fn search_ranks_name_matches_limits_and_ignores_blank_queries() {
        let mut cache = SymbolCache::default();
        for (symbol, description) in [
            ("NAS100", "Nasdaq 100 index"),
            ("XNAS", "Nasdaq composite"),
            ("AAPL", "Apple, nasdaq listed"),
            ("EURUSD", "Euro vs US Dollar"),
        ] {
            cache.upsert(broker_symbol(symbol, description)).unwrap();
        }

        // Case-insensitive, trimmed query; name matches first, then by name.
        assert_eq!(
            cache
                .search("  NAS  ", 10)
                .iter()
                .map(|symbol| symbol.symbol.as_str())
                .collect::<Vec<_>>(),
            vec!["NAS100", "XNAS", "AAPL"]
        );
        // Limit truncates the ranked list.
        assert_eq!(
            cache
                .search("nas", 1)
                .iter()
                .map(|symbol| symbol.symbol.as_str())
                .collect::<Vec<_>>(),
            vec!["NAS100"]
        );
        // Description-only matching still works without name hits.
        assert_eq!(
            cache
                .search("euro vs", 10)
                .iter()
                .map(|symbol| symbol.symbol.as_str())
                .collect::<Vec<_>>(),
            vec!["EURUSD"]
        );
        assert!(cache.search("", 10).is_empty());
        assert!(cache.search("   ", 10).is_empty());
        assert!(cache.search("nas", 0).is_empty());
        assert!(cache.search("missing", 10).is_empty());
    }

    #[test]
    fn from_file_data_keeps_only_first_valid_duplicates() {
        let file = SymbolCacheFile {
            version: SYMBOL_CACHE_FILE_VERSION,
            symbols: vec![
                broker_symbol("EURUSD", "first valid"),
                broker_symbol("EURUSD", "duplicate dropped"),
                {
                    let mut invalid = broker_symbol("BROKEN", "bad decimals");
                    invalid.volume_step = "-0.01".into();
                    invalid
                },
                broker_symbol("BROKEN", "first valid for name"),
                broker_symbol("GBPUSD", "cable"),
            ],
        };
        let cache = SymbolCache::from_file_data(file);
        assert_eq!(cache.len(), 3);
        assert_eq!(
            cache.search("eurusd", 10)[0].description,
            "first valid",
            "duplicates keep the first valid entry"
        );
        assert_eq!(
            cache.search("broken", 10)[0].description,
            "first valid for name",
            "invalid entries do not claim their name"
        );
    }

    #[test]
    fn from_file_data_drops_all_entries_on_version_mismatch() {
        let file = SymbolCacheFile {
            version: SYMBOL_CACHE_FILE_VERSION + 1,
            symbols: vec![broker_symbol("EURUSD", "valid symbol")],
        };
        let cache = SymbolCache::from_file_data(file);
        assert!(cache.is_empty(), "unexpected version drops all entries");
    }

    #[test]
    fn serde_roundtrip_preserves_version_and_symbols() {
        let mut cache = SymbolCache::default();
        cache.upsert(broker_symbol("NAS100", "Nasdaq")).unwrap();
        cache.upsert(broker_symbol("EURUSD", "Euro")).unwrap();

        let encoded = serde_json::to_string(&cache.to_file()).unwrap();
        let decoded: SymbolCacheFile = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.version, 1);
        assert_eq!(decoded.symbols.len(), 2);
        assert!(decoded
            .symbols
            .iter()
            .any(|symbol| symbol.symbol == "NAS100"));

        let restored = SymbolCache::from_file_data(decoded);
        assert_eq!(restored.to_file(), cache.to_file());
    }
}
