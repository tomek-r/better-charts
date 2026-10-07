use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::limits::history_bars;
use super::timeframes::is_supported_timeframe;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryRequest {
    pub symbol: String,
    pub timeframe: String,
    pub bars: u16,
    /// Additive pagination anchor: when present, the newest `bars` candles
    /// **strictly older** than this epoch-millisecond boundary, so a client can
    /// walk backwards through history without re-reading what it holds. Absent
    /// is the pre-extension behavior (the newest `bars`), and an absent field
    /// does not appear on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_ms: Option<i64>,
}

impl HistoryRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.symbol.is_empty()
            || !is_supported_timeframe(&self.timeframe)
            || !(1..=history_bars()).contains(&self.bars)
            || self.before_ms.is_some_and(|before_ms| before_ms <= 0)
        {
            return Err("invalid history request");
        }
        Ok(())
    }

    /// True for an older-history page rather than a fresh window request. The EA
    /// and the bridge use this to serve the page without disturbing the live
    /// bar feed the window established.
    pub fn is_page(&self) -> bool {
        self.before_ms.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarketCandle {
    pub time_ms: i64,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub tick_volume: u64,
    pub spread: u32,
    pub real_volume: u64,
}

impl MarketCandle {
    pub fn validate(&self) -> Result<(), &'static str> {
        for value in [&self.open, &self.high, &self.low, &self.close] {
            let _: Decimal = value.parse().map_err(|_| "invalid decimal price")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistorySnapshot {
    pub request_id: String,
    pub symbol: String,
    pub timeframe: String,
    pub complete: bool,
    pub candles: Vec<MarketCandle>,
    /// Echo of [`HistoryRequest::before_ms`] for a paginated response. A peer
    /// that predates the extension omits it; routing is by `request_id`, so the
    /// echo is a consistency check rather than the way a page is identified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_ms: Option<i64>,
}

impl HistorySnapshot {
    pub fn validate(&self, request: &HistoryRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id.is_empty()
            || self.symbol != request.symbol
            || self.timeframe != request.timeframe
        {
            return Err("history request mismatch");
        }
        // A page response may omit the echo (peer predating the extension), but a
        // window response must not claim to be a page, and a page that echoes a
        // different anchor is not the page that was asked for.
        let echo_conflict = match (request.before_ms, self.before_ms) {
            (None, Some(_)) => true,
            (Some(requested), Some(echoed)) => requested != echoed,
            _ => false,
        };
        if self.before_ms.is_some_and(|before_ms| before_ms <= 0) || echo_conflict {
            return Err("history request mismatch");
        }
        if self.candles.len() > 1000 {
            return Err("too many candles");
        }
        if self
            .candles
            .windows(2)
            .any(|pair| pair[0].time_ms >= pair[1].time_ms)
        {
            return Err("candles are not ordered");
        }
        for candle in &self.candles {
            candle.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BarUpdate {
    pub symbol: String,
    pub timeframe: String,
    pub candle: MarketCandle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolSearchRequest {
    pub query: String,
    pub limit: u8,
}

impl SymbolSearchRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        let length = self.query.trim().chars().count();
        if !(1..=64).contains(&length) || !(1..=50).contains(&self.limit) {
            return Err("invalid symbol search request");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrokerSymbol {
    pub symbol: String,
    pub description: String,
    pub digits: u32,
    pub tick_size: String,
    pub point_size: String,
    pub contract_size: String,
    #[serde(default)]
    pub tick_value_profit: Option<String>,
    #[serde(default)]
    pub tick_value_loss: Option<String>,
    #[serde(default)]
    pub tick_value_currency: Option<String>,
    pub volume_min: String,
    pub volume_max: String,
    pub volume_step: String,
    pub trade_mode: u32,
    pub stops_level: u32,
    pub freeze_level: u32,
    pub filling_mode: u32,
    pub order_mode: u32,
    pub expiration_mode: u32,
    pub trade_execution: u32,
}

impl BrokerSymbol {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.symbol.trim().is_empty() {
            return Err("empty symbol");
        }
        if self
            .tick_value_currency
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err("empty tick value currency");
        }
        match (&self.tick_value_profit, &self.tick_value_loss) {
            (None, None) => {}
            (Some(profit), Some(loss)) if self.tick_value_currency.is_some() => {
                for value in [profit, loss] {
                    let amount: Decimal = value.parse().map_err(|_| "invalid tick value")?;
                    if amount < Decimal::ZERO {
                        return Err("invalid tick value");
                    }
                }
            }
            _ => return Err("incomplete tick value metadata"),
        }
        let tick_size: Decimal = self
            .tick_size
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        let point_size: Decimal = self
            .point_size
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        let contract_size: Decimal = self
            .contract_size
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        let volume_min: Decimal = self
            .volume_min
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        let volume_max: Decimal = self
            .volume_max
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        let volume_step: Decimal = self
            .volume_step
            .parse()
            .map_err(|_| "invalid symbol decimal")?;
        if tick_size <= Decimal::ZERO
            || point_size <= Decimal::ZERO
            || contract_size <= Decimal::ZERO
            || volume_step <= Decimal::ZERO
            || volume_min < Decimal::ZERO
            || volume_max < Decimal::ZERO
            || volume_min > volume_max
        {
            return Err("invalid symbol trading parameters");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolSearchResult {
    pub request_id: String,
    pub query: String,
    pub symbols: Vec<BrokerSymbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuoteUpdate {
    pub symbol: String,
    pub time_ms: i64,
    pub bid: String,
    pub ask: String,
    pub last: String,
    pub volume: u64,
    pub volume_real: String,
    pub flags: u32,
}

impl QuoteUpdate {
    pub fn validate(&self, expected_symbol: &str) -> Result<(), &'static str> {
        if self.symbol != expected_symbol || self.time_ms < 0 {
            return Err("invalid quote identity");
        }
        let bid: Decimal = self.bid.parse().map_err(|_| "invalid quote decimal")?;
        let ask: Decimal = self.ask.parse().map_err(|_| "invalid quote decimal")?;
        let last: Decimal = self.last.parse().map_err(|_| "invalid quote decimal")?;
        let volume_real: Decimal = self
            .volume_real
            .parse()
            .map_err(|_| "invalid quote decimal")?;
        if bid <= Decimal::ZERO
            || ask <= Decimal::ZERO
            || last < Decimal::ZERO
            || volume_real < Decimal::ZERO
        {
            return Err("invalid quote values");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolInfoRequest {
    pub symbol: String,
}

impl SymbolInfoRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.symbol.trim().is_empty() {
            return Err("empty symbol info request");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolInfoResult {
    pub request_id: String,
    pub symbol_info: BrokerSymbol,
}

impl SymbolInfoResult {
    pub fn validate(
        &self,
        expected_request_id: &str,
        request: &SymbolInfoRequest,
    ) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id.is_empty()
            || self.request_id != expected_request_id
            || self.symbol_info.symbol != request.symbol
        {
            return Err("symbol info result mismatch");
        }
        self.symbol_info.validate()
    }
}

impl SymbolSearchResult {
    pub fn validate(&self, request: &SymbolSearchRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id.is_empty()
            || self.query != request.query
            || self.symbols.len() > request.limit as usize
        {
            return Err("symbol search response mismatch");
        }
        let mut names = std::collections::HashSet::new();
        for symbol in &self.symbols {
            symbol.validate()?;
            if !names.insert(&symbol.symbol) {
                return Err("duplicate symbol");
            }
        }
        Ok(())
    }
}

impl BarUpdate {
    pub fn validate(&self, symbol: &str, timeframe: &str) -> Result<(), &'static str> {
        if self.symbol != symbol
            || self.timeframe != timeframe
            || !is_supported_timeframe(&self.timeframe)
        {
            return Err("bar update mismatch");
        }
        self.candle.validate()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TickHistoryRequest {
    pub symbol: String,
    pub from_ms: i64,
    pub to_ms: i64,
    pub max_ticks: u16,
}

impl TickHistoryRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.symbol.is_empty()
            || self.from_ms < 0
            || self.from_ms >= self.to_ms
            || self.max_ticks == 0
        {
            return Err("invalid tick history request");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarketTick {
    pub time_ms: i64,
    pub bid: String,
    pub ask: String,
    pub last: String,
    pub volume: u64,
    pub volume_real: String,
    pub flags: u32,
}

impl MarketTick {
    pub fn validate(&self) -> Result<(), &'static str> {
        for value in [&self.bid, &self.ask, &self.last, &self.volume_real] {
            let _: Decimal = value.parse().map_err(|_| "invalid tick decimal")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TickHistorySnapshot {
    pub request_id: String,
    pub symbol: String,
    pub from_ms: i64,
    pub to_ms: i64,
    pub tick_size: String,
    pub complete: bool,
    /// Oldest chronological prefix of the requested range, never a sample.
    /// A truncated page may end inside a group of equal timestamps.
    pub ticks: Vec<MarketTick>,
}

impl TickHistorySnapshot {
    pub fn validate(&self, request: &TickHistoryRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id.is_empty()
            || self.symbol != request.symbol
            || self.from_ms != request.from_ms
            || self.to_ms != request.to_ms
            || self.ticks.len() > usize::from(request.max_ticks)
        {
            return Err("tick history request mismatch");
        }
        let tick_size: Decimal = self.tick_size.parse().map_err(|_| "invalid tick size")?;
        if tick_size <= Decimal::ZERO {
            return Err("invalid tick size");
        }
        if self
            .ticks
            .windows(2)
            .any(|pair| pair[0].time_ms > pair[1].time_ms)
        {
            return Err("ticks are not ordered");
        }
        for tick in &self.ticks {
            if tick.time_ms < request.from_ms || tick.time_ms >= request.to_ms {
                return Err("tick is outside requested range");
            }
            tick.validate()?;
        }
        Ok(())
    }
}

/// Optional exact price-count request; older peers keep the raw tick path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickPriceHistoryRequest {
    #[serde(flatten)]
    pub history: TickHistoryRequest,
    pub price_counts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickPriceCount {
    pub price: String,
    pub total: u32,
    pub bid: u32,
    pub ask: u32,
    /// Includes unflagged/rejected bid quotes for the legacy grid fallback.
    pub bid_seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickPriceHistorySnapshot {
    pub request_id: String,
    pub symbol: String,
    pub from_ms: i64,
    pub to_ms: i64,
    pub tick_size: String,
    pub complete: bool,
    /// Accepted exclusive boundary; an incomplete page re-reads this millisecond.
    pub through_ms: i64,
    pub loaded_ticks: u32,
    pub rejected_ticks: u32,
    pub min_quote: Option<String>,
    pub max_quote: Option<String>,
    pub prices: Vec<TickPriceCount>,
}

impl TickPriceHistorySnapshot {
    pub fn validate(&self, request: &TickHistoryRequest) -> Result<(), &'static str> {
        request.validate()?;
        if self.request_id.is_empty()
            || self.symbol != request.symbol
            || self.from_ms != request.from_ms
            || self.to_ms != request.to_ms
            || self.loaded_ticks > u32::from(request.max_ticks)
            || self.rejected_ticks > self.loaded_ticks
            || self.through_ms < self.from_ms
            || self.through_ms > self.to_ms
            || (self.complete && self.through_ms != self.to_ms)
            || (!self.complete && self.through_ms == self.to_ms)
            || (!self.complete && self.through_ms == self.from_ms && self.loaded_ticks != 0)
            || self.prices.len() > self.loaded_ticks as usize * 2
        {
            return Err("invalid tick price page bounds");
        }
        if self
            .tick_size
            .parse::<Decimal>()
            .map_err(|_| "invalid tick size")?
            <= Decimal::ZERO
        {
            return Err("invalid tick size");
        }
        let quotes = match (&self.min_quote, &self.max_quote) {
            (None, None) if self.loaded_ticks == 0 => None,
            (Some(low), Some(high)) if self.loaded_ticks > 0 => {
                let low = low.parse::<Decimal>().map_err(|_| "invalid quote range")?;
                let high = high.parse::<Decimal>().map_err(|_| "invalid quote range")?;
                if low > high {
                    return Err("invalid quote range");
                }
                Some((low, high))
            }
            _ => return Err("invalid quote range"),
        };
        let mut seen = std::collections::HashSet::new();
        let mut totals = [0u64; 3];
        for item in &self.prices {
            let price = item
                .price
                .parse::<Decimal>()
                .map_err(|_| "invalid profile price")?;
            if !seen.insert(price)
                || !quotes.is_some_and(|(low, high)| low <= price && price <= high)
                || item.bid > item.total
                || (!item.bid_seen && item.total > 0)
                || (price <= Decimal::ZERO && (item.total > 0 || item.ask > 0))
                || (!item.bid_seen && item.ask == 0)
            {
                return Err("invalid profile price counts");
            }
            totals[0] += u64::from(item.total);
            totals[1] += u64::from(item.bid);
            totals[2] += u64::from(item.ask);
        }
        if totals[0] > u64::from(self.loaded_ticks - self.rejected_ticks)
            || totals[1] > totals[0]
            || totals[2] > totals[0]
        {
            return Err("invalid profile count totals");
        }
        Ok(())
    }
}
