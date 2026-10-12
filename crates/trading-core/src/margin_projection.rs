//! Margin situation projected after a prospective order fills, and its
//! position relative to the broker's margin-call / stop-out thresholds.
//!
//! These are estimates for display. The fill margin comes from
//! `OrderCalcMargin`, which prices the order in isolation and ignores existing
//! positions (hedging offsets, netting), so the projection can overstate the
//! margin a netted or hedged fill would actually add. Nothing here gates or
//! alters execution.

use rust_decimal::Decimal;

/// `ENUM_ACCOUNT_STOPOUT_MODE`: the unit of `ACCOUNT_MARGIN_SO_CALL` and
/// `ACCOUNT_MARGIN_SO_SO`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarginLevelsUnit {
    /// Thresholds are margin-level percentages.
    Percent,
    /// Thresholds are amounts in the deposit currency.
    Money,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarginRisk {
    Ok,
    BelowMarginCall,
    BelowStopOut,
    /// Thresholds, mode or inputs are missing, so no verdict is possible.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarginProjection {
    /// `account_free_margin - margin_at_fill`; negative when the fill would
    /// exceed the available funds.
    pub free_margin_after: Option<Decimal>,
    /// `equity / (account_margin_used + margin_at_fill) * 100`; `None` when no margin
    /// would be in use (undefined ratio) or an input is missing.
    pub margin_level_after: Option<Decimal>,
}

/// Projects free margin and margin level for the moment the order has filled.
/// Equity is taken unchanged: an order does not alter equity until prices move.
pub fn project_margin_after_fill(
    equity: Option<Decimal>,
    account_margin_used: Option<Decimal>,
    account_free_margin: Option<Decimal>,
    margin_at_fill: Option<Decimal>,
) -> MarginProjection {
    let margin_at_fill = margin_at_fill.filter(|value| *value >= Decimal::ZERO);
    let free_margin_after = account_free_margin
        .zip(margin_at_fill)
        .and_then(|(free, fill)| free.checked_sub(fill));
    let margin_level_after = equity
        .zip(account_margin_used)
        .zip(margin_at_fill)
        .and_then(|((equity, margin), fill)| {
            let used = margin.checked_add(fill)?;
            if used <= Decimal::ZERO {
                return None;
            }
            // Multiply first so round percentages stay exact.
            equity.checked_mul(Decimal::from(100))?.checked_div(used)
        });
    MarginProjection {
        free_margin_after,
        margin_level_after,
    }
}

/// Classifies the projected state against the broker thresholds.
///
/// Semantics follow the MQL5 documentation of `ACCOUNT_MARGIN_SO_MODE`
/// (<https://www.mql5.com/en/docs/constants/environment_state/accountinformation>
/// and <https://www.mql5.com/en/book/automation/account/account_margin_used>):
/// - percent mode: the margin level (`equity / margin * 100`) is compared with
///   `ACCOUNT_MARGIN_SO_CALL` / `ACCOUNT_MARGIN_SO_SO`;
/// - money mode: the **equity** itself is compared with the same two values,
///   which are then amounts in the deposit currency (the book's check is
///   `ACCOUNT_EQUITY > ACCOUNT_MARGIN_SO_CALL`, commission omitted).
///
/// A value exactly equal to a threshold is not below it. Stop-out takes
/// precedence over margin call. `Ok` is reported only when both thresholds are
/// known and respected.
pub fn classify_margin_risk(
    mode: Option<MarginLevelsUnit>,
    margin_call: Option<Decimal>,
    stop_out: Option<Decimal>,
    equity: Option<Decimal>,
    margin_level_after: Option<Decimal>,
) -> MarginRisk {
    let Some(mode) = mode else {
        return MarginRisk::Unknown;
    };
    let measured = match mode {
        MarginLevelsUnit::Percent => margin_level_after,
        MarginLevelsUnit::Money => equity,
    };
    let Some(measured) = measured else {
        return MarginRisk::Unknown;
    };
    if stop_out.is_some_and(|level| measured < level) {
        return MarginRisk::BelowStopOut;
    }
    if margin_call.is_some_and(|level| measured < level) {
        return MarginRisk::BelowMarginCall;
    }
    if margin_call.is_some() && stop_out.is_some() {
        MarginRisk::Ok
    } else {
        MarginRisk::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    fn some(value: &str) -> Option<Decimal> {
        Some(dec(value))
    }

    #[test]
    fn projects_free_margin_and_level_after_the_fill() {
        let projection =
            project_margin_after_fill(some("10000"), some("1000"), some("9000"), some("1000"));
        assert_eq!(projection.free_margin_after, some("8000"));
        assert_eq!(projection.margin_level_after, some("500"));
    }

    #[test]
    fn free_margin_after_can_go_negative() {
        let projection =
            project_margin_after_fill(some("100"), some("40"), some("60"), some("75.5"));
        assert_eq!(projection.free_margin_after, some("-15.5"));
    }

    #[test]
    fn level_is_exact_for_round_numbers() {
        let projection =
            project_margin_after_fill(some("2000"), some("300"), some("1700"), some("200"));
        assert_eq!(projection.margin_level_after, some("400"));
    }

    #[test]
    fn level_is_undefined_without_used_margin() {
        let projection =
            project_margin_after_fill(some("2000"), some("0"), some("2000"), some("0"));
        assert_eq!(projection.margin_level_after, None);
        assert_eq!(projection.free_margin_after, some("2000"));
    }

    #[test]
    fn missing_or_negative_inputs_never_become_zero() {
        assert_eq!(
            project_margin_after_fill(some("1"), some("1"), some("1"), None),
            MarginProjection {
                free_margin_after: None,
                margin_level_after: None
            }
        );
        assert_eq!(
            project_margin_after_fill(some("1"), some("1"), some("1"), some("-1")),
            MarginProjection {
                free_margin_after: None,
                margin_level_after: None
            }
        );
        let partial = project_margin_after_fill(None, some("1"), some("5"), some("2"));
        assert_eq!(partial.free_margin_after, some("3"));
        assert_eq!(partial.margin_level_after, None);
        let partial = project_margin_after_fill(some("10"), None, None, some("2"));
        assert_eq!(partial.free_margin_after, None);
        assert_eq!(partial.margin_level_after, None);
    }

    #[test]
    fn percent_mode_compares_the_projected_level() {
        let classify = |level: &str| {
            classify_margin_risk(
                Some(MarginLevelsUnit::Percent),
                some("100"),
                some("50"),
                some("1"),
                some(level),
            )
        };
        assert_eq!(classify("150"), MarginRisk::Ok);
        assert_eq!(classify("100"), MarginRisk::Ok);
        assert_eq!(classify("99.99"), MarginRisk::BelowMarginCall);
        assert_eq!(classify("50"), MarginRisk::BelowMarginCall);
        assert_eq!(classify("49.99"), MarginRisk::BelowStopOut);
        assert_eq!(classify("-10"), MarginRisk::BelowStopOut);
    }

    #[test]
    fn money_mode_compares_equity_not_the_level() {
        let classify = |equity: &str| {
            classify_margin_risk(
                Some(MarginLevelsUnit::Money),
                some("200"),
                some("100"),
                some(equity),
                some("1"),
            )
        };
        assert_eq!(classify("500"), MarginRisk::Ok);
        assert_eq!(classify("200"), MarginRisk::Ok);
        assert_eq!(classify("199.99"), MarginRisk::BelowMarginCall);
        assert_eq!(classify("100"), MarginRisk::BelowMarginCall);
        assert_eq!(classify("99.99"), MarginRisk::BelowStopOut);
    }

    #[test]
    fn unknown_when_mode_thresholds_or_measure_are_missing() {
        let ok_percent =
            |mode, call, stop, level| classify_margin_risk(mode, call, stop, some("1"), level);
        let percent = Some(MarginLevelsUnit::Percent);
        assert_eq!(
            ok_percent(None, some("100"), some("50"), some("500")),
            MarginRisk::Unknown
        );
        assert_eq!(
            ok_percent(percent, some("100"), some("50"), None),
            MarginRisk::Unknown
        );
        assert_eq!(
            ok_percent(percent, None, some("50"), some("500")),
            MarginRisk::Unknown
        );
        assert_eq!(
            ok_percent(percent, some("100"), None, some("500")),
            MarginRisk::Unknown
        );
        // A breach is still reported when only the breached threshold is known.
        assert_eq!(
            ok_percent(percent, None, some("50"), some("10")),
            MarginRisk::BelowStopOut
        );
        assert_eq!(
            ok_percent(percent, some("100"), None, some("10")),
            MarginRisk::BelowMarginCall
        );
        assert_eq!(
            classify_margin_risk(
                Some(MarginLevelsUnit::Money),
                some("1"),
                some("1"),
                None,
                some("5")
            ),
            MarginRisk::Unknown
        );
    }
}
