//! The settings of one chart, as the frontend defines them: one JSON object the store keeps as
//! text without interpreting a single field. The frontend owns the schema, so a setting it adds
//! later needs no change here.

use super::error::ChartSettingsError;
use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

/// The most text one chart's settings may occupy in the database.
pub(super) const MAX_SETTINGS_BYTES: usize = 32 * 1024;

/// The JSON text of a document that holds no setting.
const EMPTY_SETTINGS_TEXT: &str = "{}";

/// A chart settings document: the JSON object the frontend sends and reads back.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SettingsDocument(Map<String, Value>);

impl SettingsDocument {
    /// The document `text` holds. Only a JSON object is a document, because the frontend reads
    /// named settings out of it; anything else stored is reported as unreadable instead.
    pub(crate) fn parse(text: &str) -> Result<Self, ChartSettingsError> {
        // The map itself refuses every JSON value that is not an object, so a document handed
        // back always has named settings the frontend can look up.
        let settings: Map<String, Value> =
            serde_json::from_str(text).map_err(|_| ChartSettingsError::Unreadable)?;
        Ok(Self(settings))
    }

    /// The document the frontend sent, refused when its stored text would be larger than
    /// [`MAX_SETTINGS_BYTES`], so one chart can never grow the database without a bound.
    pub(crate) fn new(settings: Map<String, Value>) -> Result<Self, ChartSettingsError> {
        let document = Self(settings);
        if document.to_text().len() > MAX_SETTINGS_BYTES {
            return Err(ChartSettingsError::Invalid(
                "Chart settings are larger than 32 KiB".to_owned(),
            ));
        }
        Ok(document)
    }

    /// Whether the document holds no setting at all, the state a chart without overrides is in.
    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The document as the JSON text the database column keeps.
    pub(crate) fn to_text(&self) -> String {
        // Every kept value came from serde_json and every key is a string, so this always
        // serializes; an empty document stands in rather than failing the row it belongs to.
        serde_json::to_string(&self.0).unwrap_or_else(|_| EMPTY_SETTINGS_TEXT.to_owned())
    }
}

impl Default for SettingsDocument {
    /// The empty document: a chart with no overrides of its own.
    fn default() -> Self {
        Self(Map::new())
    }
}

impl Serialize for SettingsDocument {
    /// The plain object, so the frontend reads the same fields it sent and nothing wraps them.
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}
