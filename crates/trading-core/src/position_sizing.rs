//! Risk calculations and volume normalization to broker parameters.

use crate::protocol::{RiskQuoteRequest, RiskQuoteResult};
use rust_decimal::Decimal;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RiskSizingError {
    #[error("Risk amount must be non-negative")]
    NegativeRisk,
    #[error("Insufficient free margin for broker minimum volume")]
    InsufficientMargin,
    #[error("Equity allocation must be greater than 0 and at most 100 percent")]
    InvalidEquityAllocation,
    #[error("Positive account equity is required for margin allocation")]
    InvalidEquity,
    #[error("Invalid quote parameters")]
    InvalidQuote,
    #[error("Risk is too low for the minimum order size at this SL distance.")]
    BelowMinimum,
    #[error("Risk sizing arithmetic overflow")]
    ArithmeticOverflow,
    #[error("Risk sizing arithmetic loses decimal precision")]
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

/// Margin allocation is based on total equity, bounded by funds still available.
pub fn equity_margin_budget(
    equity: Decimal,
    free_margin: Decimal,
    percent: Decimal,
) -> Result<Decimal, RiskSizingError> {
    if percent <= Decimal::ZERO || percent > Decimal::from(100) {
        return Err(RiskSizingError::InvalidEquityAllocation);
    }
    if equity <= Decimal::ZERO {
        return Err(RiskSizingError::InvalidEquity);
    }
    if free_margin < Decimal::ZERO {
        return Err(RiskSizingError::InsufficientMargin);
    }
    let fraction = percent
        .checked_div(Decimal::from(100))
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    if fraction == Decimal::ZERO {
        return Err(RiskSizingError::ArithmeticPrecisionLoss);
    }
    Ok(checked_mul(equity, fraction)?.min(free_margin))
}

/// Tentative display quote only; preserve broker conversion/margin estimates
/// while adapting price distances. A fresh broker quote is required to submit.
pub fn project_risk_quote(
    previous: &RiskQuoteResult,
    request: &RiskQuoteRequest,
) -> Result<RiskQuoteResult, RiskSizingError> {
    let previous_request = RiskQuoteRequest {
        draft_id: previous.draft_id.clone(),
        symbol: previous.symbol.clone(),
        side: previous.side,
        entry: previous.entry.clone(),
        stop_loss: previous.stop_loss.clone(),
        take_profit: previous.take_profit.clone(),
    };
    previous
        .validate(&previous_request)
        .map_err(|_| RiskSizingError::InvalidQuote)?;
    request
        .validate()
        .map_err(|_| RiskSizingError::InvalidQuote)?;
    if request.symbol != previous.symbol || request.side != previous.side {
        return Err(RiskSizingError::InvalidQuote);
    }
    let parse = |value: &str| {
        value
            .parse::<Decimal>()
            .map_err(|_| RiskSizingError::InvalidQuote)
    };
    let old_entry = parse(&previous.entry)?;
    let entry = parse(&request.entry)?;
    let old_stop_distance = (parse(&previous.stop_loss)? - old_entry).abs();
    let stop_distance = (parse(&request.stop_loss)? - entry).abs();
    let mut projected = previous.clone();
    projected.draft_id = request.draft_id.clone();
    projected.entry = request.entry.clone();
    projected.stop_loss = request.stop_loss.clone();
    projected.take_profit = request.take_profit.clone();
    projected.loss_at_reference = checked_scale(
        parse(&previous.loss_at_reference)?,
        stop_distance,
        old_stop_distance,
    )?
    .normalize()
    .to_string();
    projected.reward_at_reference = match (
        previous.reward_at_reference.as_deref(),
        previous.take_profit.as_deref(),
        request.take_profit.as_deref(),
    ) {
        (Some(reward), Some(old_target), Some(target)) => Some(
            checked_scale(
                parse(reward)?,
                (parse(target)? - entry).abs(),
                (parse(old_target)? - old_entry).abs(),
            )?
            .normalize()
            .to_string(),
        ),
        _ => None,
    };
    Ok(projected)
}

/// Fit a risk budget by moving SL, starting from a preferred volume. The quote's
/// SL is the nearest permitted stop; never move closer than that seed. This is
/// a tentative projection and must be followed by a fresh broker quote.
pub fn fit_risk_stop_loss(
    quote: &RiskQuoteResult,
    risk: Decimal,
    margin_budget: Decimal,
    preferred_volume: Decimal,
) -> Result<(RiskQuoteResult, RiskSizingResult), RiskSizingError> {
    let parameters = SizingQuote::parse(quote)?;
    if preferred_volume <= Decimal::ZERO || parameters.min <= Decimal::ZERO {
        return Err(RiskSizingError::InvalidQuote);
    }
    // At the closest permitted stop, sizing gives the upper bound from both
    // risk and margin. Preserve the preferred volume wherever it fits.
    let allowed = calculate_risk_sizing(risk, margin_budget, quote)?;
    let cap = preferred_volume.max(parameters.min).min(
        allowed
            .volume
            .parse()
            .map_err(|_| RiskSizingError::InvalidQuote)?,
    );
    let steps = cap
        .checked_sub(parameters.min)
        .and_then(|value| value.checked_div(parameters.step))
        .ok_or(RiskSizingError::ArithmeticOverflow)?
        .floor();
    let volume = parameters
        .min
        .checked_add(checked_mul(steps, parameters.step)?)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    let parse = |text: &str| {
        text.parse::<Decimal>()
            .map_err(|_| RiskSizingError::InvalidQuote)
    };
    let entry = parse(&quote.entry)?;
    let seed = parse(&quote.stop_loss)?;
    let tick = parse(&quote.tick_size)?;
    if tick <= Decimal::ZERO {
        return Err(RiskSizingError::InvalidQuote);
    }
    let distance = checked_scale(
        (entry - seed).abs(),
        risk,
        checked_scale(parameters.loss, volume, parameters.reference)?,
    )?;
    let raw_stop = match quote.side {
        crate::protocol::OrderSide::Buy => entry.checked_sub(distance),
        crate::protocol::OrderSide::Sell => entry.checked_add(distance),
    }
    .ok_or(RiskSizingError::ArithmeticOverflow)?;
    let grid = raw_stop
        .checked_div(tick)
        .ok_or(RiskSizingError::ArithmeticOverflow)?;
    // Round toward entry to avoid exceeding the budget, bounded by the seed.
    let stop = match quote.side {
        crate::protocol::OrderSide::Buy => checked_mul(grid.ceil(), tick)?.min(seed),
        crate::protocol::OrderSide::Sell => checked_mul(grid.floor(), tick)?.max(seed),
    };
    let request = RiskQuoteRequest {
        draft_id: quote.draft_id.clone(),
        symbol: quote.symbol.clone(),
        side: quote.side,
        entry: quote.entry.clone(),
        stop_loss: stop.normalize().to_string(),
        take_profit: quote.take_profit.clone(),
    };
    let fitted = project_risk_quote(quote, &request)?;
    // Price rounding can leave spare risk; do not use it to grow the chosen size.
    let mut capped = fitted.clone();
    capped.volume_max = volume.normalize().to_string();
    capped.reference_volume = volume.normalize().to_string();
    capped.loss_at_reference = checked_scale(
        parse(&fitted.loss_at_reference)?,
        volume,
        parameters.reference,
    )?
    .normalize()
    .to_string();
    capped.margin_at_reference = checked_scale(parameters.margin, volume, parameters.reference)?
        .normalize()
        .to_string();
    capped.reward_at_reference = fitted
        .reward_at_reference
        .as_deref()
        .map(|reward| {
            checked_scale(parse(reward)?, volume, parameters.reference)
                .map(|value| value.normalize().to_string())
        })
        .transpose()?;
    let sizing = calculate_risk_sizing(risk, margin_budget, &capped)?;
    Ok((fitted, sizing))
}

pub fn calculate_risk_sizing(
    risk_amount: Decimal,
    free_margin: Decimal,
    quote: &RiskQuoteResult,
) -> Result<RiskSizingResult, RiskSizingError> {
    if risk_amount <= Decimal::ZERO {
        return Err(RiskSizingError::NegativeRisk);
    }
    if free_margin < Decimal::ZERO {
        return Err(RiskSizingError::InsufficientMargin);
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
    let margin_cap = if sizing_quote.margin == Decimal::ZERO {
        sizing_quote.max
    } else {
        checked_mul(free_margin, sizing_quote.reference)?
            .checked_div(sizing_quote.margin)
            .unwrap_or(sizing_quote.max)
    };
    if margin_cap < sizing_quote.min {
        return Err(RiskSizingError::InsufficientMargin);
    }
    let capped = raw.min(sizing_quote.max).min(margin_cap);
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
    let mut estimated_margin = checked_scale(sizing_quote.margin, volume, sizing_quote.reference)?;
    // Decimal division can round at the final scale. If that rounding put a
    // candidate on the wrong side of its budget, one fewer broker step keeps
    // the result conservative; recompute the estimate and check the budget.
    if estimated_risk > risk_amount || estimated_margin > free_margin {
        if volume <= sizing_quote.min {
            return Err(if estimated_margin > free_margin {
                RiskSizingError::InsufficientMargin
            } else {
                RiskSizingError::BelowMinimum
            });
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
        estimated_margin = checked_scale(sizing_quote.margin, volume, sizing_quote.reference)?;
        if estimated_margin > free_margin {
            return Err(RiskSizingError::InsufficientMargin);
        }
    }
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
    fn fitting_risk_moves_stop_for_preferred_volume_on_buy_and_sell_tick_grids() {
        for side in [OrderSide::Buy, OrderSide::Sell] {
            let mut q = quote();
            q.side = side;
            q.stop_loss = if side == OrderSide::Buy { "99" } else { "101" }.into();
            q.take_profit = None;
            q.reward_at_reference = None;
            q.loss_at_reference = "10".into();
            let (fitted, sized) =
                fit_risk_stop_loss(&q, Decimal::from(103), Decimal::from(10000), Decimal::ONE)
                    .unwrap();
            assert_eq!(
                fitted.stop_loss,
                if side == OrderSide::Buy {
                    "89.7"
                } else {
                    "110.3"
                }
            );
            assert_eq!(sized.volume, "1");
            assert_eq!(sized.estimated_risk, "103");
        }
    }

    #[test]
    fn fitting_risk_respects_margin_lot_steps_and_minimum_stop_distance() {
        let mut q = quote();
        q.stop_loss = "99".into();
        q.loss_at_reference = "10".into();
        q.take_profit = None;
        q.reward_at_reference = None;
        let (fitted, sized) =
            fit_risk_stop_loss(&q, Decimal::from(100), Decimal::from(600), Decimal::ONE).unwrap();
        assert_eq!(sized.volume, "0.5");
        assert_eq!(fitted.stop_loss, "80");
        assert_eq!(sized.estimated_risk, "100");
        let (fitted, sized) =
            fit_risk_stop_loss(&q, Decimal::from(5), Decimal::from(10000), Decimal::ONE).unwrap();
        assert_eq!(sized.volume, "0.5");
        assert_eq!(fitted.stop_loss, "99");
        let (_, sized) = fit_risk_stop_loss(
            &q,
            Decimal::from(103),
            Decimal::from(10000),
            Decimal::new(37, 2),
        )
        .unwrap();
        assert_eq!(sized.volume, "0.37");
        assert!(sized.estimated_risk.parse::<Decimal>().unwrap() <= Decimal::from(103));
        assert!(fit_risk_stop_loss(&q, Decimal::ONE, Decimal::ZERO, Decimal::ONE).is_err());
        assert!(fit_risk_stop_loss(&q, Decimal::ONE, Decimal::ONE, Decimal::ZERO).is_err());
    }

    #[test]
    fn equity_allocation_is_capped_by_free_margin_and_not_remaining_margin_percentage() {
        for (percent, expected) in [(40, 4000), (60, 6000), (100, 6000)] {
            assert_eq!(
                equity_margin_budget(
                    Decimal::from(10000),
                    Decimal::from(6000),
                    Decimal::from(percent)
                ),
                Ok(Decimal::from(expected))
            );
        }
        assert_eq!(
            equity_margin_budget(Decimal::from(10000), Decimal::from(3000), Decimal::from(40)),
            Ok(Decimal::from(3000))
        );
    }

    #[test]
    fn equity_allocation_rejects_invalid_percent_and_unavailable_equity() {
        for percent in [Decimal::ZERO, Decimal::NEGATIVE_ONE, Decimal::from(101)] {
            assert!(
                equity_margin_budget(Decimal::from(10000), Decimal::from(6000), percent).is_err()
            );
        }
        assert!(
            equity_margin_budget(Decimal::ZERO, Decimal::from(6000), Decimal::from(100)).is_err()
        );
        assert!(equity_margin_budget(
            Decimal::NEGATIVE_ONE,
            Decimal::from(6000),
            Decimal::from(100)
        )
        .is_err());
        assert_eq!(
            equity_margin_budget(
                Decimal::from(10000),
                Decimal::NEGATIVE_ONE,
                Decimal::from(100)
            ),
            Err(RiskSizingError::InsufficientMargin)
        );
        assert_eq!(
            equity_margin_budget(Decimal::MAX, Decimal::MAX, Decimal::from(100)),
            Ok(Decimal::MAX)
        );
        assert!(equity_margin_budget(
            "0.0000000000000000000000000001".parse().unwrap(),
            Decimal::ONE,
            Decimal::ONE
        )
        .is_err());
    }

    #[test]
    fn projected_stop_sizing_keeps_risk_and_broker_margin_limits() {
        for side in [
            crate::protocol::OrderSide::Buy,
            crate::protocol::OrderSide::Sell,
        ] {
            let mut original = quote();
            original.side = side;
            if side == crate::protocol::OrderSide::Sell {
                original.stop_loss = "110".into();
                original.take_profit = Some("80".into());
            }
            let request = crate::protocol::RiskQuoteRequest {
                draft_id: "projection-2".into(),
                symbol: original.symbol.clone(),
                side,
                entry: "100".into(),
                stop_loss: if side == crate::protocol::OrderSide::Buy {
                    "80"
                } else {
                    "120"
                }
                .into(),
                take_profit: original.take_profit.clone(),
            };
            let projected = project_risk_quote(&original, &request).unwrap();
            assert_eq!(projected.loss_at_reference, "480");
            let sizing =
                calculate_risk_sizing(Decimal::from(100), Decimal::from(1000), &projected).unwrap();
            assert_eq!(sizing.volume, "0.2");
            assert_eq!(sizing.estimated_risk, "96");
            assert_eq!(sizing.estimated_margin, "240");
            let capped =
                calculate_risk_sizing(Decimal::from(100), Decimal::from(100), &projected).unwrap();
            assert_eq!(capped.volume, "0.08");
            assert_eq!(capped.estimated_risk, "38.4");
            let mut invalid = request;
            invalid.stop_loss = "100".into();
            assert!(project_risk_quote(&original, &invalid).is_err());
            invalid.stop_loss = "80".into();
            invalid.symbol = "OTHER".into();
            assert!(project_risk_quote(&original, &invalid).is_err());
        }
    }

    #[test]
    fn free_margin_caps_volume_below_risk_budget() {
        let result =
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100), &quote()).unwrap();
        assert_eq!(result.volume, "0.08");
        assert_eq!(result.estimated_margin, "96");
        assert_eq!(result.estimated_risk, "19.2");
        assert_eq!(result.rr.as_deref(), Some("2"));
    }

    #[test]
    fn minimum_volume_must_fit_free_margin() {
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), "11.99".parse().unwrap(), &quote()),
            Err(RiskSizingError::InsufficientMargin)
        );
        let result =
            calculate_risk_sizing(Decimal::from(100), Decimal::from(12), &quote()).unwrap();
        assert_eq!(result.volume, "0.01");
        assert_eq!(result.estimated_margin, "12");
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), Decimal::ZERO, &quote()),
            Err(RiskSizingError::InsufficientMargin)
        );
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), Decimal::NEGATIVE_ONE, &quote()),
            Err(RiskSizingError::InsufficientMargin)
        );
    }

    #[test]
    fn margin_cap_respects_reference_volume_and_broker_grid() {
        let mut q = quote();
        q.reference_volume = "0.25".into();
        q.volume_min = "0.05".into();
        q.volume_step = "0.1".into();
        q.margin_at_reference = "100".into();
        let result = calculate_risk_sizing(Decimal::from(1000), Decimal::from(99), &q).unwrap();
        assert_eq!(result.volume, "0.15");
        assert_eq!(result.estimated_margin, "60");
    }

    #[test]
    fn recurring_margin_division_never_exceeds_free_margin() {
        let mut q = quote();
        q.reference_volume = "3".into();
        q.margin_at_reference = "1".into();
        q.volume_min = "1".into();
        q.volume_step = "1".into();
        let free = "0.6666666666666666666666666666".parse().unwrap();
        let result = calculate_risk_sizing(Decimal::from(1000), free, &q).unwrap();
        assert_eq!(result.volume, "1");
        assert!(result.estimated_margin.parse::<Decimal>().unwrap() <= free);
    }

    #[test]
    fn extreme_margin_quotes_remain_bounded() {
        let mut q = quote();
        q.margin_at_reference = Decimal::MAX.to_string();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100), &q),
            Err(RiskSizingError::InsufficientMargin)
        );
        q.margin_at_reference = "0.0000000000000000000000000001".into();
        let result =
            calculate_risk_sizing(Decimal::from(100_000), Decimal::from(100_000), &q).unwrap();
        assert_eq!(result.volume, "10");
    }

    #[test]
    fn example_and_reward() {
        let result =
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100_000), &quote()).unwrap();
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
            calculate_risk_sizing(Decimal::from(1), Decimal::from(100_000), &q),
            Err(RiskSizingError::BelowMinimum)
        );
        q.reward_at_reference = Some("480".into());
        q.volume_min = "0.01".into();
        q.volume_max = "0.2".into();
        q.reference_volume = "0.2".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(1000), Decimal::from(100_000), &q)
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
            calculate_risk_sizing(Decimal::from(100), Decimal::ZERO, &q)
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
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100_000), &q),
            Err(RiskSizingError::InvalidQuote)
        );
        q.margin_at_reference = "NaN".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100_000), &q),
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
        let result = calculate_risk_sizing(Decimal::from(100), Decimal::from(100_000), &q).unwrap();
        assert_eq!(result.volume, "10");
    }

    #[test]
    fn quote_arithmetic_overflow_is_reported_as_typed_error() {
        let mut q = quote();
        q.margin_at_reference = "0".into();
        q.loss_at_reference = "1".into();
        q.reward_at_reference = Some(Decimal::MAX.to_string());
        q.volume_max = "10".into();
        q.volume_min = "1".into();
        q.volume_step = "1".into();
        assert_eq!(
            calculate_risk_sizing(Decimal::from(100), Decimal::from(100_000), &q),
            Err(RiskSizingError::ArithmeticOverflow)
        );

        q.margin_at_reference = "0".into();
        q.reference_volume = "10".into();
        q.reward_at_reference = None;
        assert_eq!(
            calculate_risk_sizing(Decimal::MAX, Decimal::from(100_000), &q),
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
            calculate_risk_sizing(
                "0.0000000000000000000000000001".parse().unwrap(),
                Decimal::ZERO,
                &q
            ),
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

        let result = calculate_risk_sizing("0.34".parse().unwrap(), Decimal::ZERO, &q).unwrap();
        assert_eq!(result.volume, "1");
        assert_eq!(result.estimated_risk, "0.3333333333333333333333333333");
        assert_eq!(
            result.estimated_reward,
            Some("0.6666666666666666666666666667".into())
        );
        assert_eq!(result.rr, Some("2.0000000000000000000000000003".into()));
    }
}
