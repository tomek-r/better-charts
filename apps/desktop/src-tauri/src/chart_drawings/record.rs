//! One saved drawing, as the frontend exports it and as the store keeps it.
//!
//! Every tool stores the same shape: the shared fields plus an ordered list of anchor
//! points. A point names a time in epoch milliseconds, a price, or both; a price stays
//! decimal text, so a number the user placed reaches the chart again with the same digits.

use super::{
    error::ChartDrawingError, limits::is_present_within, timeframe_visibility::TimeframeVisibility,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Longest accepted id or tool id of one drawing.
const MAX_ID_BYTES: usize = 64;
/// Most settings one drawing may carry.
const MAX_INPUTS: usize = 64;
/// Longest accepted name of one setting.
const MAX_INPUT_KEY_BYTES: usize = 64;
/// Longest accepted text value of one setting.
const MAX_INPUT_STRING_BYTES: usize = 4096;
/// Most anchor points one drawing may carry.
pub(crate) const MAX_POINTS_PER_DRAWING: usize = 2000;
/// Longest accepted price text: a full decimal, never an exponent.
const MAX_PRICE_TEXT_CHARS: usize = 32;

/// One anchor point of a drawing: a time, a price, or both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChartDrawingPoint {
    /// Epoch milliseconds of the anchored slot; absent for a price-only anchor.
    pub(crate) time_ms: Option<i64>,
    /// Decimal text, so a stored price is never re-rounded.
    pub(crate) price: Option<String>,
}

impl ChartDrawingPoint {
    /// Whether the store may keep this anchor: it must name a time, a price, or both, and a
    /// price must be decimal text.
    fn validate(&self) -> Result<(), ChartDrawingError> {
        if self.time_ms.is_none() && self.price.is_none() {
            return Err(ChartDrawingError::Invalid(
                "A drawing point needs a time or a price".to_owned(),
            ));
        }
        match &self.price {
            Some(price) if !is_decimal_text(price) => Err(ChartDrawingError::Invalid(format!(
                "A drawing price must be decimal text of at most {MAX_PRICE_TEXT_CHARS} characters"
            ))),
            _ => Ok(()),
        }
    }
}

/// One tool's drawing, stamped with the tool that owns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChartDrawingRecord {
    pub(crate) id: String,
    pub(crate) tool_id: String,
    /// A locked drawing ignores edit gestures until it is unlocked.
    pub(crate) locked: bool,
    /// Whether the drawing is painted; hiding is stored but not yet acted on by the tools.
    pub(crate) visible: bool,
    /// Whether the drawing is stacked below the price bars; drawings keep their list order on
    /// both sides of the bars. Absent in older payloads, which carry every drawing above them.
    #[serde(default)]
    pub(crate) below_bars: bool,
    /// On which timeframes the drawing paints. Absent in older payloads, which show it everywhere.
    #[serde(default)]
    pub(crate) timeframe_visibility: TimeframeVisibility,
    pub(crate) inputs: BTreeMap<String, Value>,
    /// The anchors of the drawing, in paint order.
    pub(crate) points: Vec<ChartDrawingPoint>,
}

impl ChartDrawingRecord {
    /// The shape a stored drawing must have for the store to keep it. A record that fails here
    /// is refused instead of written, so the database only ever holds drawings a tool can import.
    pub(crate) fn validate(&self) -> Result<(), ChartDrawingError> {
        if !is_present_within(&self.id, MAX_ID_BYTES) {
            return Err(ChartDrawingError::Invalid(format!(
                "A drawing needs an id of 1 to {MAX_ID_BYTES} bytes"
            )));
        }
        if !is_present_within(&self.tool_id, MAX_ID_BYTES) {
            return Err(ChartDrawingError::Invalid(format!(
                "A drawing needs a tool id of 1 to {MAX_ID_BYTES} bytes"
            )));
        }
        self.timeframe_visibility.validate()?;
        self.validate_inputs()?;
        self.validate_points()
    }

    fn validate_inputs(&self) -> Result<(), ChartDrawingError> {
        if self.inputs.len() > MAX_INPUTS {
            return Err(ChartDrawingError::Invalid(format!(
                "A drawing holds at most {MAX_INPUTS} settings"
            )));
        }
        for (name, value) in &self.inputs {
            if !is_present_within(name, MAX_INPUT_KEY_BYTES) {
                return Err(ChartDrawingError::Invalid(format!(
                    "A drawing setting needs a name of 1 to {MAX_INPUT_KEY_BYTES} bytes"
                )));
            }
            if !is_storable_input_value(value) {
                return Err(ChartDrawingError::Invalid(format!(
                    "A drawing setting holds a number, a boolean or a string of at most \
                     {MAX_INPUT_STRING_BYTES} bytes"
                )));
            }
        }
        Ok(())
    }

    fn validate_points(&self) -> Result<(), ChartDrawingError> {
        if self.points.is_empty() || self.points.len() > MAX_POINTS_PER_DRAWING {
            return Err(ChartDrawingError::Invalid(format!(
                "A drawing needs 1 to {MAX_POINTS_PER_DRAWING} points"
            )));
        }
        for point in &self.points {
            point.validate()?;
        }
        Ok(())
    }
}

fn is_storable_input_value(value: &Value) -> bool {
    match value {
        Value::Number(_) | Value::Bool(_) => true,
        Value::String(text) => text.len() <= MAX_INPUT_STRING_BYTES,
        Value::Null | Value::Array(_) | Value::Object(_) => false,
    }
}

/// Whether `text` is plain decimal text: an optional `-`, then digits, then an optional `.` and
/// more digits. No exponent and no separators, so the stored price is exactly the user's digits.
fn is_decimal_text(text: &str) -> bool {
    if text.len() > MAX_PRICE_TEXT_CHARS {
        return false;
    }
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (unsigned, ""),
    };
    let has_fraction = unsigned.len() > whole.len();
    is_digits(whole) && (!has_fraction || is_digits(fraction))
}

/// Whether `part` is one or more ASCII digits; an empty part is not a number.
fn is_digits(part: &str) -> bool {
    !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn point(time_ms: Option<i64>, price: Option<&str>) -> ChartDrawingPoint {
        ChartDrawingPoint {
            time_ms,
            price: price.map(str::to_owned),
        }
    }

    fn record() -> ChartDrawingRecord {
        ChartDrawingRecord {
            id: "profile-1".into(),
            tool_id: "fixedRangeProfile".into(),
            locked: false,
            visible: true,
            below_bars: false,
            timeframe_visibility: TimeframeVisibility::default(),
            inputs: BTreeMap::from([("rows".into(), json!(128))]),
            points: vec![point(Some(1), None), point(Some(2), None)],
        }
    }

    fn refusal(changed: ChartDrawingRecord) -> String {
        let error = changed.validate().expect_err("the record is refused");
        error.to_string()
    }

    #[test]
    fn a_complete_record_passes() {
        assert!(record().validate().is_ok());
    }

    #[test]
    fn a_stored_record_uses_the_frontend_field_names() {
        let stored: ChartDrawingRecord = serde_json::from_str(
            r#"{"id":"profile-1","toolId":"fixedRangeProfile","locked":false,"visible":true,
                "inputs":{},"points":[{"timeMs":1700000000000,"price":null},{"timeMs":null,"price":"1.0850"}]}"#,
        )
        .expect("the record parses");

        assert_eq!(stored.points[0].time_ms, Some(1_700_000_000_000));
        assert_eq!(stored.points[1].price.as_deref(), Some("1.0850"));

        let unknown_field = r#"{"id":"p","toolId":"t","locked":false,"visible":true,"inputs":{},
            "points":[{"timeMs":1,"price":null}],"geometry":null}"#;
        assert!(serde_json::from_str::<ChartDrawingRecord>(unknown_field).is_err());
    }

    #[test]
    fn the_id_and_the_tool_id_are_required_and_bounded() {
        let mut empty_id = record();
        empty_id.id = String::new();
        assert!(refusal(empty_id).contains("id"));

        let mut long_id = record();
        long_id.id = "i".repeat(MAX_ID_BYTES + 1);
        assert!(refusal(long_id).contains("id"));

        let mut empty_tool = record();
        empty_tool.tool_id = String::new();
        assert!(refusal(empty_tool).contains("tool id"));

        let mut long_tool = record();
        long_tool.tool_id = "t".repeat(MAX_ID_BYTES + 1);
        assert!(refusal(long_tool).contains("tool id"));
    }

    #[test]
    fn the_number_of_settings_is_bounded() {
        let mut crowded = record();
        crowded.inputs = (0..=MAX_INPUTS)
            .map(|index| (format!("setting-{index}"), json!(index)))
            .collect();

        assert!(refusal(crowded).contains("settings"));

        let mut full = record();
        full.inputs = (0..MAX_INPUTS)
            .map(|index| (format!("setting-{index}"), json!(index)))
            .collect();
        assert!(full.validate().is_ok());
    }

    #[test]
    fn setting_names_are_required_and_bounded() {
        let mut unnamed = record();
        unnamed.inputs = BTreeMap::from([(String::new(), json!(1))]);
        assert!(refusal(unnamed).contains("name"));

        let mut long_name = record();
        long_name.inputs = BTreeMap::from([("k".repeat(MAX_INPUT_KEY_BYTES + 1), json!(1))]);
        assert!(refusal(long_name).contains("name"));
    }

    #[test]
    fn a_setting_value_is_a_number_a_boolean_or_a_bounded_string() {
        for refused in [json!(null), json!([1]), json!({ "nested": 1 })] {
            let mut record = record();
            record.inputs = BTreeMap::from([("setting".into(), refused)]);
            assert!(refusal(record).contains("number, a boolean or a string"));
        }

        let mut long_text = record();
        long_text.inputs =
            BTreeMap::from([("note".into(), json!("x".repeat(MAX_INPUT_STRING_BYTES + 1)))]);
        assert!(refusal(long_text).contains("number, a boolean or a string"));

        let mut storable = record();
        storable.inputs = BTreeMap::from([
            ("rows".into(), json!(12)),
            ("visible".into(), json!(true)),
            ("label".into(), json!("x".repeat(MAX_INPUT_STRING_BYTES))),
        ]);
        assert!(storable.validate().is_ok());
    }

    #[test]
    fn the_number_of_points_is_bounded() {
        let mut empty = record();
        empty.points = Vec::new();
        assert!(refusal(empty).contains("1 to"));

        let mut crowded = record();
        crowded.points = (0..=MAX_POINTS_PER_DRAWING)
            .map(|_| point(Some(1), None))
            .collect();
        assert!(refusal(crowded).contains("1 to"));

        let mut full = record();
        full.points = (0..MAX_POINTS_PER_DRAWING)
            .map(|_| point(Some(1), None))
            .collect();
        assert!(full.validate().is_ok());
    }

    #[test]
    fn a_point_needs_a_time_or_a_price() {
        let mut without_anchor = record();
        without_anchor.points = vec![point(None, None)];
        assert!(refusal(without_anchor).contains("time or a price"));
    }

    #[test]
    fn a_price_is_plain_decimal_text() {
        for accepted in ["1", "1.0850", "-0.5", "00123", "1.0"] {
            assert!(is_decimal_text(accepted), "{accepted} is decimal text");
        }
        for refused in [
            "", "-", ".5", "1.", "1e5", "1,5", "+1", " 1", "1.2.3", "1.0f",
        ] {
            assert!(!is_decimal_text(refused), "{refused} is not decimal text");
        }
        let longest = "1".repeat(MAX_PRICE_TEXT_CHARS);
        assert!(is_decimal_text(&longest));
        assert!(!is_decimal_text(&"1".repeat(MAX_PRICE_TEXT_CHARS + 1)));
    }

    #[test]
    fn a_record_with_a_price_only_point_passes() {
        let mut priced = record();
        priced.points = vec![
            point(None, Some("1.0850")),
            point(Some(5_000), Some("-2.5")),
        ];
        assert!(priced.validate().is_ok());

        let mut exponent = record();
        exponent.points = vec![point(None, Some("1e5"))];
        assert!(refusal(exponent).contains("decimal text"));
    }
}
