//! Persisted symbol cache: search views, live upserts and corrupt-file recovery.
use super::common::*;
use super::*;

fn temp_symbol_cache_path() -> std::path::PathBuf {
    static NEXT_TEMP_SYMBOL_CACHE: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "symbol-cache-{}-{}-{}.json",
        std::process::id(),
        now_ms(),
        NEXT_TEMP_SYMBOL_CACHE.fetch_add(1, Ordering::Relaxed)
    ))
}

#[test]
fn cached_search_returns_cache_derived_view_without_a_session() {
    let state = BridgeState::with_symbol_cache_path(None);
    assert!(state.current_session.lock().unwrap().is_none());
    state.remember_symbols([broker_symbol("NAS100")]);

    // The command publishes this view verbatim as `symbol-search-result`.
    let view = search_symbols_inner(&state, "  nas  ".into(), 10)
        .unwrap()
        .expect("a missing session must answer from the local cache");
    assert_eq!(view.source, "cached");
    assert_eq!(view.query, "nas", "the trimmed query is echoed back");
    assert_eq!(view.symbols.len(), 1);
    assert_eq!(view.symbols[0].symbol, "NAS100");
    let json = serde_json::to_value(&view).unwrap();
    assert_eq!(json["source"], "cached");
    assert_eq!(json["query"], "nas");

    // An empty cache still answers so the UI renders "no results".
    let empty = search_symbols_inner(&state, "missing".into(), 10)
        .unwrap()
        .unwrap();
    assert!(empty.symbols.is_empty());

    // Invalid queries keep failing before any cache lookup.
    assert!(search_symbols_inner(&state, "bad\"query".into(), 10).is_err());
    assert!(search_symbols_inner(&state, "nas".into(), 0).is_err());
}

#[test]
fn live_symbol_search_result_upserts_cache_and_persists_across_restart() {
    let path = temp_symbol_cache_path();
    let state = BridgeState::with_symbol_cache_path(Some(path.clone()));
    *state.expected_symbol_search.lock().unwrap() = Some((
        "search-1".into(),
        SymbolSearchRequest {
            query: "nas".into(),
            limit: 10,
        },
    ));
    let view = match accept_symbol_search_result(
        &state,
        SymbolSearchResult {
            request_id: "search-1".into(),
            query: "nas".into(),
            symbols: vec![broker_symbol("NAS100")],
        },
    ) {
        SymbolSearchOutcome::Accepted(view) => view,
        _ => panic!("expected the live result to be accepted"),
    };
    assert_eq!(view.source, "live");

    let persisted = std::fs::read_to_string(&path).unwrap();
    let file: trading_core::symbol_cache::SymbolCacheFile =
        serde_json::from_str(&persisted).unwrap();
    assert_eq!(
        file.version,
        trading_core::symbol_cache::SYMBOL_CACHE_FILE_VERSION
    );
    assert_eq!(file.symbols.len(), 1);
    assert_eq!(file.symbols[0].symbol, "NAS100");

    // A restart (fresh state, no session) finds the persisted symbol.
    let reloaded = BridgeState::with_symbol_cache_path(Some(path.clone()));
    assert_eq!(reloaded.symbol_cache.lock().unwrap().cache.len(), 1);
    let cached = search_symbols_inner(&reloaded, "nas".into(), 10)
        .unwrap()
        .unwrap();
    assert_eq!(cached.source, "cached");
    assert_eq!(cached.symbols[0].symbol, "NAS100");
    let _ = std::fs::remove_file(path);
}

#[test]
fn live_symbol_search_result_reports_live_source() {
    let state = BridgeState::with_symbol_cache_path(None);
    *state.expected_symbol_search.lock().unwrap() = Some((
        "search-2".into(),
        SymbolSearchRequest {
            query: "eur".into(),
            limit: 5,
        },
    ));
    let SymbolSearchOutcome::Accepted(view) = accept_symbol_search_result(
        &state,
        SymbolSearchResult {
            request_id: "search-2".into(),
            query: "eur".into(),
            symbols: vec![broker_symbol("EURUSD")],
        },
    ) else {
        panic!("expected the live result to be accepted");
    };
    assert_eq!(view.source, "live");
    assert_eq!(view.query, "eur");
    let json = serde_json::to_value(&view).unwrap();
    assert_eq!(json["source"], "live");
    assert!(state.expected_symbol_search.lock().unwrap().is_none());
}

#[test]
fn corrupt_symbol_cache_file_fails_open_and_search_still_works() {
    let path = temp_symbol_cache_path();
    std::fs::write(&path, b"{ not valid json !!!").unwrap();
    let state = BridgeState::with_symbol_cache_path(Some(path.clone()));
    assert_eq!(state.symbol_cache.lock().unwrap().cache.len(), 0);

    let view = search_symbols_inner(&state, "nas".into(), 10)
        .unwrap()
        .expect("a corrupt cache must not break the cached search path");
    assert_eq!(view.source, "cached");
    assert!(view.symbols.is_empty());

    // The next accepted symbol replaces the corrupt file with valid JSON.
    state.remember_symbols([broker_symbol("NAS100")]);
    let recovered: trading_core::symbol_cache::SymbolCacheFile =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(recovered.symbols.len(), 1);
    assert_eq!(recovered.symbols[0].symbol, "NAS100");
    let _ = std::fs::remove_file(path);
}
