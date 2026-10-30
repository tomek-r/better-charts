//! The time zone one chart was last shown in: the broker's own server clock, or an IANA zone the
//! user picked. It is kept per account and symbol, so each chart comes back the way it was left.

use super::error::ChartDrawingError;

/// The broker's own server clock: what every chart shows until the user picks a zone.
pub(crate) const EXCHANGE: &str = "exchange";

/// The longest zone id a chart keeps; every IANA id, nested areas included, fits well inside.
const MAX_TIME_ZONE_BYTES: usize = 64;

/// The characters a zone id may hold besides ASCII letters and digits.
const ZONE_SEPARATORS: [char; 4] = ['/', '_', '+', '-'];

/// The time zone one chart shows its bars in, as the zone id the frontend picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartTimeZone(String);

impl ChartTimeZone {
    /// The zone `value` names: [`EXCHANGE`], or an IANA id such as `America/New_York`. Anything
    /// else is refused, so a stored zone is always one this build can hand back.
    pub(crate) fn new(value: String) -> Result<Self, ChartDrawingError> {
        if value != EXCHANGE && !is_iana_zone_id(&value) {
            return Err(ChartDrawingError::Invalid(format!(
                "A chart time zone is \"exchange\" or an IANA zone of 1 to {MAX_TIME_ZONE_BYTES} characters"
            )));
        }
        Ok(Self(value))
    }

    /// The zone id exactly as stored, for the database column that keeps it.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// The zone id as the frontend handed it over, for the command that answers with it.
    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

/// Whether `value` has the shape of an IANA zone id: at most [`MAX_TIME_ZONE_BYTES`], an ASCII
/// letter first, then ASCII letters, digits and the separators zone ids use. The shape is what
/// an IANA id is made of, so a name from anywhere else never reaches the database or the chart.
fn is_iana_zone_id(value: &str) -> bool {
    if value.len() > MAX_TIME_ZONE_BYTES {
        return false;
    }
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    first.is_ascii_alphabetic() && characters.all(is_zone_character)
}

/// Whether `character` may stand in a zone id after its first letter.
fn is_zone_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || ZONE_SEPARATORS.contains(&character)
}
