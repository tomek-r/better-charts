//! Partial-close volume rules: which volumes may be closed out of an open
//! position without leaving an unclosable remainder.

use rust_decimal::Decimal;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PartialCloseError {
    #[error("position volume limits are invalid")]
    InvalidLimits,
    #[error("close volume must be a positive decimal")]
    InvalidVolume,
    #[error("close volume is below the symbol minimum")]
    BelowMinimum,
    #[error("close volume exceeds the position volume")]
    AbovePosition,
    #[error("close volume is not a multiple of the symbol volume step")]
    NotStepMultiple,
    #[error("remaining volume would be below the symbol minimum")]
    RemainderBelowMinimum,
}

/// A position's volume together with its symbol's volume constraints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PartialCloseLimits {
    position_volume: Decimal,
    volume_min: Decimal,
    volume_step: Decimal,
}

impl PartialCloseLimits {
    /// Fails closed unless all three values are positive.
    pub fn new(
        position_volume: Decimal,
        volume_min: Decimal,
        volume_step: Decimal,
    ) -> Result<Self, PartialCloseError> {
        let all_positive = [position_volume, volume_min, volume_step]
            .iter()
            .all(|value| *value > Decimal::ZERO);
        if all_positive {
            Ok(Self {
                position_volume,
                volume_min,
                volume_step,
            })
        } else {
            Err(PartialCloseError::InvalidLimits)
        }
    }

    pub fn parse(
        position_volume: &str,
        volume_min: &str,
        volume_step: &str,
    ) -> Result<Self, PartialCloseError> {
        let parse = |text: &str| {
            text.parse::<Decimal>()
                .map_err(|_| PartialCloseError::InvalidLimits)
        };
        Self::new(
            parse(position_volume)?,
            parse(volume_min)?,
            parse(volume_step)?,
        )
    }

    /// Checks a requested close volume given as a decimal string.
    pub fn validate_text(&self, volume: &str) -> Result<Decimal, PartialCloseError> {
        let volume = volume
            .parse::<Decimal>()
            .map_err(|_| PartialCloseError::InvalidVolume)?;
        self.validate(volume)
    }

    /// A full close (`volume == position`) passes; callers wanting a strictly
    /// partial close must compare against the position volume themselves.
    pub fn validate(&self, volume: Decimal) -> Result<Decimal, PartialCloseError> {
        if volume <= Decimal::ZERO {
            return Err(PartialCloseError::InvalidVolume);
        }
        if volume < self.volume_min {
            return Err(PartialCloseError::BelowMinimum);
        }
        if volume > self.position_volume {
            return Err(PartialCloseError::AbovePosition);
        }
        if volume % self.volume_step != Decimal::ZERO {
            return Err(PartialCloseError::NotStepMultiple);
        }
        let remainder = self.position_volume - volume;
        if remainder != Decimal::ZERO && remainder < self.volume_min {
            return Err(PartialCloseError::RemainderBelowMinimum);
        }
        Ok(volume)
    }

    /// True when some volume can be closed while a valid remainder stays open.
    pub fn is_splittable(&self) -> bool {
        self.volume_min
            .checked_mul(Decimal::TWO)
            .is_some_and(|double_minimum| self.position_volume >= double_minimum)
    }

    /// `percent` of the position rounded down to the step, or `None` when that
    /// is not a valid strictly partial volume.
    pub fn preset(&self, percent: u32) -> Option<Decimal> {
        let raw = self
            .position_volume
            .checked_mul(Decimal::from(percent))?
            .checked_div(Decimal::ONE_HUNDRED)?;
        let rounded = (raw / self.volume_step).floor() * self.volume_step;
        self.validate(rounded)
            .ok()
            .filter(|volume| *volume != self.position_volume)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits(position: &str, min: &str, step: &str) -> PartialCloseLimits {
        PartialCloseLimits::parse(position, min, step).unwrap()
    }

    fn dec(text: &str) -> Decimal {
        text.parse().unwrap()
    }

    #[test]
    fn validate_table() {
        use PartialCloseError::*;
        let cases = [
            ("1.00", "0.01", "0.01", "0.30", Ok("0.30")),
            ("1.00", "0.01", "0.01", "0.99", Ok("0.99")),
            ("1.00", "0.01", "0.01", "1.00", Ok("1.00")),
            ("1.00", "0.01", "0.01", "0.00", Err(InvalidVolume)),
            ("1.00", "0.01", "0.01", "-0.10", Err(InvalidVolume)),
            ("1.00", "0.01", "0.01", "0.005", Err(BelowMinimum)),
            ("1.00", "0.10", "0.10", "0.05", Err(BelowMinimum)),
            ("1.00", "0.01", "0.01", "1.01", Err(AbovePosition)),
            ("1.00", "0.01", "0.10", "0.25", Err(NotStepMultiple)),
            ("1.00", "0.01", "0.10", "0.30", Ok("0.30")),
            ("0.01", "0.01", "0.01", "0.01", Ok("0.01")),
            ("0.15", "0.10", "0.01", "0.10", Err(RemainderBelowMinimum)),
            ("0.15", "0.10", "0.01", "0.05", Err(BelowMinimum)),
            ("0.20", "0.10", "0.01", "0.10", Ok("0.10")),
        ];
        for (position, min, step, volume, expected) in cases {
            let outcome = limits(position, min, step).validate_text(volume);
            assert_eq!(
                outcome,
                expected.map(dec),
                "position {position} min {min} step {step} volume {volume}"
            );
        }
    }

    #[test]
    fn validate_text_rejects_malformed_volume() {
        assert_eq!(
            limits("1", "0.01", "0.01").validate_text("abc"),
            Err(PartialCloseError::InvalidVolume)
        );
    }

    #[test]
    fn limits_reject_non_positive_or_malformed_inputs() {
        for (position, min, step) in [
            ("0", "0.01", "0.01"),
            ("1", "0", "0.01"),
            ("1", "0.01", "-1"),
        ] {
            assert_eq!(
                PartialCloseLimits::parse(position, min, step),
                Err(PartialCloseError::InvalidLimits)
            );
        }
        assert_eq!(
            PartialCloseLimits::parse("x", "0.01", "0.01"),
            Err(PartialCloseError::InvalidLimits)
        );
    }

    #[test]
    fn splittable_requires_two_minimum_lots() {
        assert!(!limits("0.01", "0.01", "0.01").is_splittable());
        assert!(limits("0.02", "0.01", "0.01").is_splittable());
        assert!(!limits("0.19", "0.10", "0.01").is_splittable());
        assert!(limits("1.00", "0.01", "0.10").is_splittable());
    }

    #[test]
    fn preset_rounds_down_to_step() {
        let position = limits("1.00", "0.01", "0.01");
        assert_eq!(position.preset(25), Some(dec("0.25")));
        assert_eq!(position.preset(50), Some(dec("0.50")));
        assert_eq!(limits("1.00", "0.01", "0.10").preset(25), Some(dec("0.20")));
        assert_eq!(limits("0.07", "0.01", "0.01").preset(50), Some(dec("0.03")));
    }

    #[test]
    fn preset_is_none_when_not_a_valid_partial_volume() {
        assert_eq!(limits("0.01", "0.01", "0.01").preset(50), None);
        assert_eq!(limits("1.00", "0.01", "0.01").preset(100), None);
        assert_eq!(limits("0.15", "0.10", "0.01").preset(75), None);
        assert_eq!(limits("1.00", "0.50", "0.01").preset(25), None);
    }
}
