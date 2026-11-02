//! The settings store behind the commands: the layout it hands out, the overrides it keeps per
//! chart, account and symbol, and what it refuses.

use super::{
    error::ChartSettingsError,
    settings_document::{SettingsDocument, MAX_SETTINGS_BYTES},
    sqlite_settings_store::SqliteChartSettingsStore,
    store::ChartSettingsStore,
};
use crate::chart_database::{self, ChartScope};
use serde_json::{json, Value};

/// The account the stub's bridge reports, spelled the way the frontend scopes it.
const ACCOUNT_KEY: &str = "50123456@Broker-Demo";

/// A store of its own in memory: the tests never touch the user's chart database.
fn store() -> SqliteChartSettingsStore {
    SqliteChartSettingsStore::from_database(
        chart_database::in_memory().expect("the in-memory database opens"),
    )
}

/// The scope of the account and symbol on the one chart the store seeds.
fn seeded_scope(store: &SqliteChartSettingsStore, account_key: &str, symbol: &str) -> ChartScope {
    let layout = store.load_layout().expect("the layout loads");
    ChartScope::new(
        layout[0].chart_id.clone(),
        account_key.to_owned(),
        symbol.to_owned(),
    )
    .expect("the scope is valid")
}

/// The document the frontend would send for `settings`.
fn document(settings: Value) -> SettingsDocument {
    let object = settings.as_object().expect("a document is an object");
    SettingsDocument::new(object.clone()).expect("the document is within the limits")
}

#[test]
fn the_layout_holds_the_one_seeded_chart() {
    let store = store();

    let layout = store.load_layout().expect("the layout loads");
    let again = store.load_layout().expect("the layout loads again");

    assert_eq!(layout.len(), 1);
    assert!(!layout[0].chart_id.is_empty());
    assert!(!layout[0].group_id.is_empty());
    assert_ne!(layout[0].chart_id, layout[0].group_id);
    assert_eq!(layout[0].template_id, "default");
    assert_eq!(again[0].chart_id, layout[0].chart_id);
    assert_eq!(again[0].group_id, layout[0].group_id);
}

#[test]
fn the_default_template_holds_no_settings() {
    let store = store();
    let scope = seeded_scope(&store, ACCOUNT_KEY, "EURUSD");

    let loaded = store.load_settings(&scope).expect("the settings load");

    assert_eq!(loaded.template_id, "default");
    assert!(loaded.template_settings.is_empty());
    assert!(loaded.overrides.is_empty());
}

#[test]
fn the_overrides_of_one_chart_round_trip() {
    let store = store();
    let scope = seeded_scope(&store, ACCOUNT_KEY, "EURUSD");
    let overrides = document(json!({"theme": "dark", "bars": {"up": "#0f0"}}));

    store
        .save_overrides(&scope, &overrides)
        .expect("the overrides save");

    let loaded = store.load_settings(&scope).expect("the settings load");
    assert_eq!(loaded.overrides.to_text(), overrides.to_text());
    assert!(!loaded.overrides.is_empty());
}

#[test]
fn saving_an_empty_document_removes_the_overrides() {
    let store = store();
    let scope = seeded_scope(&store, ACCOUNT_KEY, "EURUSD");
    store
        .save_overrides(&scope, &document(json!({"theme": "dark"})))
        .expect("the overrides save");

    store
        .save_overrides(&scope, &SettingsDocument::default())
        .expect("the overrides are removed");

    let loaded = store.load_settings(&scope).expect("the settings load");
    assert!(loaded.overrides.is_empty());
}

#[test]
fn the_overrides_of_one_scope_never_reach_another() {
    let store = store();
    let eurusd = seeded_scope(&store, ACCOUNT_KEY, "EURUSD");
    let nas100 = seeded_scope(&store, ACCOUNT_KEY, "NAS100");
    store
        .save_overrides(&eurusd, &document(json!({"theme": "dark"})))
        .expect("the overrides save");

    let loaded = store.load_settings(&nas100).expect("the settings load");

    assert!(loaded.overrides.is_empty());
}

#[test]
fn an_unknown_chart_is_refused_for_load_and_save() {
    let store = store();
    let removed = ChartScope::new(
        "no-such-chart".to_owned(),
        ACCOUNT_KEY.to_owned(),
        "EURUSD".to_owned(),
    )
    .expect("the scope is valid");

    assert!(matches!(
        store.load_settings(&removed),
        Err(ChartSettingsError::UnknownChart)
    ));
    assert!(matches!(
        store.save_overrides(&removed, &document(json!({"theme": "dark"}))),
        Err(ChartSettingsError::UnknownChart)
    ));
}

#[test]
fn a_document_larger_than_the_limit_is_refused() {
    let crowded = json!({ "payload": "x".repeat(MAX_SETTINGS_BYTES) });
    let settings = crowded
        .as_object()
        .expect("a document is an object")
        .clone();

    let refused = SettingsDocument::new(settings).expect_err("the document is too large");

    assert!(
        matches!(&refused, ChartSettingsError::Invalid(_)),
        "{refused:?}"
    );
    assert!(refused.to_string().contains("32 KiB"), "{refused}");
}

#[test]
fn a_settings_document_is_one_json_object() {
    assert!(SettingsDocument::parse("{}")
        .expect("the empty object parses")
        .is_empty());
    assert_eq!(
        SettingsDocument::parse(r#"{"theme":"dark"}"#)
            .expect("the object parses")
            .to_text(),
        r#"{"theme":"dark"}"#
    );
    for refused in ["[]", "null", "3", "\"text\"", "not json"] {
        assert!(
            matches!(
                SettingsDocument::parse(refused),
                Err(ChartSettingsError::Unreadable)
            ),
            "{refused} is refused"
        );
    }
}
