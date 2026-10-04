//! Risk calculations and volume normalization to broker parameters.

use crate::protocol::RiskQuoteResult;
use rust_decimal::Decimal;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RiskSizingError {
    #[error("risk amount must be non-negative")]
    NegativeRisk,
    #[error("invalid quote parameters")]
    InvalidQuote,
    #[error("normalized volume is below broker minimum")]
    BelowMinimum,
    #[error("risk sizing arithmetic overflow")]
    ArithmeticOverflow,
    #[error("risk sizing arithmetic loses decimal precision")]
    ArithmeticPrecisionLoss,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RiskSizingResult {
    pub volume: String,
    pub estimated_risk: String,
    pub estimated_margin: String,
    pub estimated_reward: Option<String>,
    pub rr: Option<String>,
}

struct SizingQuote {
    reference: Decimal,
    loss: Decimal,
    margin: Decimal,
    min: Decimal,
    max: Decimal,
    step: Decimal,
    reward: Option<Decimal>,
}

impl SizingQuote {
    fn parse(quote: &RiskQuoteResult) -> Result<Self, RiskSizingError> {
        let parse = |value: &str| {
            value
                .parse::<Decimal>()
                .map_err(|_| RiskSizingError::InvalidQuote)
        };
        let parsed = Self {
            reference: parse(&quote.reference_volume)?,
            loss: parse(&quote.loss_at_reference)?,
            margin: parse(&quote.margin_at_reference)?,
            min: parse(&quote.volume_min)?,
            max: parse(&quote.volume_max)?,
            step: parse(&quote.volume_step)?,
            reward: None,
        };
        if parsed.reference <= Decimal::ZERO
            || parsed.loss <= Decimal::ZERO
            || parsed.margin < Decimal::ZERO
            || parsed.min < Decimal::ZERO
            || parsed.max < parsed.min
            || parsed.step <= Decimal::ZERO
            || parsed.reference < parsed.min
            || parsed.reference > parsed.max
            || (parsed.reference - parsed.min) % parsed.step != Decimal::ZERO
        {
            return Err(RiskSizingError::InvalidQuote);
        }
        Ok(parsed)
    }
}

pub fn calculate_risk_sizing(
    risk_amount: Decimal,
    quote: &RiskQuoteResult,
) -> Result<RiskSizingResult, RiskSizingError> {
    if risk_amount <= Decimal::ZERO {
        return Err(RiskSizingError::NegativeRisk);
    }
    let mut sizing_quote = SizingQuote::parse(quote)?;
    let numerator = checked_mul(risk_amount, sizing_quote.reference)?;
    // A positive quotient that does not fit Decimal is necessarily above the
    // broker's representable maximum, so cap it instead of rejecting a valid
    // high-risk request (for example, a quote with an extremely small loss).
    let raw = numerator
        .checked_div(sizing_quote.loss)
        .unwrap_or(sizing_quote.max);
    if raw < sizing_quote.min {
        return Err(RiskSizingError::BelowMinimum);
    }
    sizing_quote.reward = quote
        .reward_at_reference
        .as_deref()
        .map(|value| {
            value
                .parse::<Decimal>()
                .map_err(|_| RiskSizingError::InvalidQuote)
        })
        .transpose()?;
    let capped = raw.min(sizing_quote.max);
    let steps = capped
        .checked_sub(sizing_quote.min)
        .and_then(|distance| distance.checked_div(sizing_quote.step))
        .ok_or(RiskSizingError::ArithmeticOverflow)?
        .floor();
    let increment = checked_mul(steps, sizing_quote.step)?;
    let mut volume = sizing_quote
        .min
        .checked_add(increment)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    if volume < sizing_quote.min || !is_on_volume_grid(volume, &sizing_quote)? {
        return Err(RiskSizingError::BelowMinimum);
    }
    let mut estimated_risk = checked_scale(sizing_quote.loss, volume, sizing_quote.reference)?;
    if estimated_risk == Decimal::ZERO {
        return Err(RiskSizingError::ArithmeticPrecisionLoss);
    }
    // Decimal division can round at the final scale. If that rounding put a
    // candidate on the wrong side of its budget, one fewer broker step keeps
    // the result conservative; recompute the estimate and check the budget.
    if estimated_risk > risk_amount {
        if volume <= sizing_quote.min {
            return Err(RiskSizingError::BelowMinimum);
        }
        volume = volume
            .checked_sub(sizing_quote.step)
            .ok_or(RiskSizingError::ArithmeticOverflow)?;
        if volume < sizing_quote.min || !is_on_volume_grid(volume, &sizing_quote)? {
            return Err(RiskSizingError::BelowMinimum);
        }
        estimated_risk = checked_scale(sizing_quote.loss, volume, sizing_quote.reference)?;
        if estimated_risk == Decimal::ZERO {
            return Err(RiskSizingError::ArithmeticPrecisionLoss);
        }
        if estimated_risk > risk_amount {
            return Err(RiskSizingError::BelowMinimum);
        }
    }
    let estimated_margin = checked_scale(sizing_quote.margin, volume, sizing_quote.reference)?;
    let estimated_reward = sizing_quote
        .reward
        .map(|reward| checked_scale(reward, volume, sizing_quote.reference))
        .transpose()?;
    let rr = estimated_reward
        .map(|reward| {
            reward
                .checked_div(estimated_risk)
                .ok_or(RiskSizingError::ArithmeticOverflow)
        })
        .transpose()?;
    if rr == Some(Decimal::ZERO) && estimated_reward != Some(Decimal::ZERO) {
        return Err(RiskSizingError::ArithmeticPrecisionLoss);
    }
    Ok(RiskSizingResult {
        volume: volume.normalize().to_string(),
        estimated_risk: estimated_risk.normalize().to_string(),
        estimated_margin: estimated_margin.normalize().to_string(),
        estimated_reward: estimated_reward.map(|v| v.normalize().to_string()),
        rr: rr.map(|v| v.normalize().to_string()),
    })
}

fn checked_mul(left: Decimal, right: Decimal) -> Result<Decimal, RiskSizingError> {
    let product = left
        .checked_mul(right)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    if left != Decimal::ZERO && right != Decimal::ZERO && product == Decimal::ZERO {
        return Err(RiskSizingError::ArithmeticPrecisionLoss);
    }
    Ok(product)
}

fn checked_scale(
    amount: Decimal,
    volume: Decimal,
    reference: Decimal,
) -> Result<Decimal, RiskSizingError> {
    let product = checked_mul(amount, volume)?;
    let scaled = product
        .checked_div(reference)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    if product != Decimal::ZERO && scaled == Decimal::ZERO {
        return Err(RiskSizingError::ArithmeticPrecisionLoss);
    }
    Ok(scaled)
}

fn is_on_volume_grid(volume: Decimal, quote: &SizingQuote) -> Result<bool, RiskSizingError> {
    let offset = volume
        .checked_sub(quote.min)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    let remainder = offset
        .checked_rem(quote.step)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    Ok(remainder == Decimal::ZERO)
}

#[cfg(test)]
mod risk_tests {
    use super::*;
    use crate::protocol::{OrderSide, RiskQuoteResult};

    fn quote() -> RiskQuoteResult {
        RiskQuoteResult {
            draft_id: "d".into(),
            symbol: "NAS".into(),
            side: OrderSide::Buy,
            entry: "100".into(),
            stop_loss: "90".into(),
            take_profit: Some("120".into()),
            reference_volume: "1".into(),
            loss_at_reference: "240".into(),
            reward_at_reference: Some("480".into()),
            margin_at_reference: "1200".into(),
            currency: "USD".into(),
            tick_size: "0.1".into(),
            volume_min: "0.01".into(),
            volume_max: "10".into(),
            volume_step: "0.01".into(),
            quoted_at_ms: 1,
        }
    }
    #[test]
    fn example_and_reward() {
        let result = calculate_risk_sizing(Decimal::from(100), &quote()).unwrap();
        assert_eq!(result.volume, "0.41");
        assert_eq!(result.estimated_risk, "98.4");
        assert_eq!(result.estimated_margin, "492");
        assert_eq!(result.rr.as_deref(), Some("2"));
    }
    #[test]
    fn below_minimum_and_max_clamp() {
        let mut q = quote();
        q.volume_min = "1".into();
        q.reward_at_reference = Some("invalid reward".into());
        assert_eq!(
            calculate_risk_sizing(Decimal::from(1), &q),
            Err(RiskSizingError::BelowMinimum)
        );
        q.reward_at_reference = Some("480".into());
        q.volume_min = "0.01".into();
        q.volume_max = "0.2".into();
        q.reference_volume = "0.2".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(1000), &q)
                .unwrap()
                .volume,
            "0.2"
        );
    }

    #[test]
    fn zero_margin_is_valid_and_scales_deterministically() {
        let mut q = quote();
        q.margin_at_reference = "0".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), &q)
                .unwrap()
                .estimated_margin,
            "0"
        );
    }

    #[test]
    fn invalid_margin_is_rejected() {
        let mut q = quote();
        q.margin_at_reference = "-1".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), &q),
            Err(RiskSizingError::InvalidQuote)
        );
        q.margin_at_reference = "NaN".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), &q),
            Err(RiskSizingError::InvalidQuote)
        );
    }

    #[test]
    fn tiny_quote_loss_caps_volume_without_division_panic() {
        let mut q = quote();
        q.loss_at_reference = "0.0000000000000000000000000001".into();
        q.volume_min = "1".into();
        q.volume_max = "10".into();
        q.volume_step = "1".into();
        q.reward_at_reference = None;
        let result = calculate_risk_sizing(Decimal::from(100), &q).unwrap();
        assert_eq!(result.volume, "10");
    }

    #[test]
    fn quote_arithmetic_overflow_is_reported_as_typed_error() {
        let mut q = quote();
        q.margin_at_reference = Decimal::MAX.to_string();
        q.loss_at_reference = "1".into();
        q.volume_max = "10".into();
        q.volume_min = "1".into();
        q.volume_step = "1".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), &q),
            Err(RiskSizingError::ArithmeticOverflow)
        );

        q.margin_at_reference = "0".into();
        q.reference_volume = "10".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::MAX, &q),
            Err(RiskSizingError::ArithmeticOverflow)
        );
    }

    #[test]
    fn zero_estimated_risk_is_a_precision_error() {
        let mut q = quote();
        let maximum = Decimal::MAX.to_string();
        q.reference_volume = maximum.clone();
        q.loss_at_reference = maximum.clone();
        q.volume_min = "0".into();
        q.volume_max = maximum;
        q.volume_step = "1".into();
        q.margin_at_reference = "0".into();
        q.reward_at_reference = None;
        assert_eq!(
            calculate_risk_sizing("0.0000000000000000000000000001".parse().unwrap(), &q),
            Err(RiskSizingError::ArithmeticPrecisionLoss)
        );
    }

    #[test]
    fn recurring_rational_estimates_keep_decimal_rounding_behavior() {
        let mut q = quote();
        q.reference_volume = "3".into();
        q.loss_at_reference = "1".into();
        q.reward_at_reference = Some("2".into());
        q.margin_at_reference = "0".into();
        q.volume_min = "1".into();
        q.volume_max = "3".into();
        q.volume_step = "1".into();

        let result = calculate_risk_sizing("0.34".parse().unwrap(), &q).unwrap();
        assert_eq!(result.volume, "1");
        assert_eq!(result.estimated_risk, "0.3333333333333333333333333333");
        assert_eq!(
            result.estimated_reward,
            Some("0.6666666666666666666666666667".into())
        );
        assert_eq!(result.rr, Some("2.0000000000000000000000000003".into()));
    }
}
