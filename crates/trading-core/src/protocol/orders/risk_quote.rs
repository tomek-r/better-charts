use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::super::OrderSide;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RiskQuoteRequest {
    pub draft_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub entry: String,
    pub stop_loss: String,
    pub take_profit: Option<String>,
}

impl RiskQuoteRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.draft_id.is_empty() || self.symbol.trim().is_empty() {
            return Err("invalid risk request identity");
        }
        let entry: Decimal = self.entry.parse().map_err(|_| "invalid risk price")?;
        let stop: Decimal = self.stop_loss.parse().map_err(|_| "invalid risk price")?;
        if entry <= Decimal::ZERO || stop <= Decimal::ZERO {
            return Err("invalid risk price");
        }
        let take = self
            .take_profit
            .as_ref()
            .map(|v| v.parse::<Decimal>())
            .transpose()
            .map_err(|_| "invalid risk price")?;
        if take.is_some_and(|value| value <= Decimal::ZERO) {
            return Err("invalid risk price");
        }
        match self.side {
            OrderSide::Buy if stop >= entry || take.is_some_and(|v| v <= entry) => {
                Err("invalid buy geometry")
            }
            OrderSide::Sell if stop <= entry || take.is_some_and(|v| v >= entry) => {
                Err("invalid sell geometry")
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RiskQuoteResult {
    pub draft_id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub entry: String,
    pub stop_loss: String,
    pub take_profit: Option<String>,
    pub reference_volume: String,
    pub loss_at_reference: String,
    pub reward_at_reference: Option<String>,
    pub margin_at_reference: String,
    pub currency: String,
    pub tick_size: String,
    pub volume_min: String,
    pub volume_max: String,
    pub volume_step: String,
    pub quoted_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RiskQuoteError {
    pub draft_id: String,
    pub code: String,
    pub message: String,
}

impl RiskQuoteResult {
    pub fn validate(&self, request: &RiskQuoteRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.draft_id != request.draft_id
            || self.symbol != request.symbol
            || self.side != request.side
            || self.take_profit.is_some() != request.take_profit.is_some()
            || self.currency.trim().is_empty()
            || self.quoted_at_ms < 0
        {
            return Err("risk quote mismatch");
        }
        let reference: Decimal = self
            .reference_volume
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let loss: Decimal = self
            .loss_at_reference
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let margin: Decimal = self
            .margin_at_reference
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let tick: Decimal = self
            .tick_size
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let min: Decimal = self
            .volume_min
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let max: Decimal = self
            .volume_max
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let step: Decimal = self
            .volume_step
            .parse()
            .map_err(|_| "invalid risk parameter")?;
        let request_entry: Decimal = request.entry.parse().map_err(|_| "invalid risk price")?;
        let request_stop: Decimal = request
            .stop_loss
            .parse()
            .map_err(|_| "invalid risk price")?;
        let entry: Decimal = self.entry.parse().map_err(|_| "invalid risk price")?;
        let stop: Decimal = self.stop_loss.parse().map_err(|_| "invalid risk price")?;
        if reference <= Decimal::ZERO
            || loss <= Decimal::ZERO
            || margin < Decimal::ZERO
            || tick <= Decimal::ZERO
            || step <= Decimal::ZERO
            || min <= Decimal::ZERO
            || max < min
        {
            return Err("invalid risk parameter");
        }
        if reference < min || reference > max || (reference - min) % step != Decimal::ZERO {
            return Err("invalid risk parameter");
        }
        if entry % tick != Decimal::ZERO
            || stop % tick != Decimal::ZERO
            || (entry - request_entry).abs() >= tick
            || (stop - request_stop).abs() >= tick
        {
            return Err("risk quote price mismatch");
        }
        if let Some((result_tp, request_tp)) =
            self.take_profit.as_ref().zip(request.take_profit.as_ref())
        {
            let tp: Decimal = result_tp.parse().map_err(|_| "invalid risk price")?;
            let request_tp: Decimal = request_tp.parse().map_err(|_| "invalid risk price")?;
            if tp <= Decimal::ZERO || tp % tick != Decimal::ZERO || (tp - request_tp).abs() >= tick
            {
                return Err("risk quote price mismatch");
            }
            match self.side {
                OrderSide::Buy if stop >= entry || tp <= entry => {
                    return Err("invalid buy geometry")
                }
                OrderSide::Sell if stop <= entry || tp >= entry => {
                    return Err("invalid sell geometry")
                }
                _ => {}
            }
        } else if matches!(self.side, OrderSide::Buy) && stop >= entry
            || matches!(self.side, OrderSide::Sell) && stop <= entry
        {
            return Err("invalid risk geometry");
        }
        if let Some(reward) = &self.reward_at_reference {
            if reward
                .parse::<Decimal>()
                .map_err(|_| "invalid risk parameter")?
                < Decimal::ZERO
            {
                return Err("invalid risk parameter");
            }
        }
        Ok(())
    }
}
